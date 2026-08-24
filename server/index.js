import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import session from "express-session";
import passport from "passport";
import passportGoogle from "passport-google-oauth20";
import { GoogleGenAI } from "@google/genai";
import connectDB from "./src/config/database.js";
import authRoutes from "./src/routes/authRoutes.js";
import configRoutes from "./src/routes/configRoutes.js";
import User from "./src/models/User.js";
import Settings from "./src/models/Settings.js";

const GoogleStrategy = passportGoogle.Strategy;

const app = express();
const PORT = process.env.PORT || 5001;

// Подключаем базу данных
connectDB();

// Логируем АБСОЛУТНО все входящие запросы для диагностики
app.use(morgan("dev"));

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json());

// Сессии
app.use(
  session({
    secret: process.env.SESSION_SECRET || "default_session_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 дней
    },
  }),
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Настройка Google Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.SERVER_URL}/auth/callback`,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        console.log("👤 Google Profile получен:", {
          id: profile.id,
          email: profile.emails?.[0]?.value,
          displayName: profile.displayName,
          photo: profile.photos?.[0]?.value,
          accessToken: !!accessToken,
          refreshToken: !!refreshToken,
        });

        let user = await User.findOne({ googleId: profile.id });
        const isNewUser = !user;

        if (isNewUser) {
          console.log("📝 Создаем нового пользователя...");
          user = new User({
            googleId: profile.id,
            email: profile.emails[0].value,
            displayName: profile.displayName,
            picture:
              profile.photos && profile.photos[0]
                ? profile.photos[0].value
                : "",
          });
          await user.save();
          console.log("✓ Новый пользователь создан:", user._id);
        } else {
          console.log("✓ Пользователь найден в БД:", user._id);
        }

        // Сохраняем токены Google Drive в Settings
        // Делаем это ВСЕГДА, независимо от того, новый это или существующий пользователь
        if (accessToken || refreshToken) {
          console.log("💾 Сохраняем токены Drive для пользователя:", user._id);
          let settings = await Settings.findOne({ userId: user._id });
          if (!settings) {
            settings = new Settings({ userId: user._id });
          }
          settings.driveTokens = {
            access_token: accessToken,
            refresh_token: refreshToken || settings.driveTokens?.refresh_token,
            expiry_date: new Date().getTime() + 3600 * 1000,
          };
          await settings.save();
          console.log("✓ Токены Drive сохранены (driveTokens заполнен)");
        }

        done(null, user);
      } catch (err) {
        console.error("❌ Ошибка в Google Strategy:", err);
        done(err, null);
      }
    },
  ),
);

// Сериализация сессии
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Маршруты
app.use("/auth", authRoutes);
app.use("/api/settings", configRoutes);

// Эндпоинт генерации контента
app.post("/api/generate", async (req, res) => {
  try {
    const { prompt, type, style } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Промпт обязателен для генерации" });
    }

    const userApiKey = req.headers["x-goog-api-key"];
    const apiKey = userApiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(401).json({
        error:
          "API-ключ Google AI не найден. Укажите его в настройках приложения или на сервере в .env",
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const modelName = "gemini-2.5-flash";

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Сгенерируй контент на основе следующего запроса.\nТип контента: ${type || "text"}\nСтиль: ${style || "standard"}\nПромпт: ${prompt}`,
            },
          ],
        },
      ],
    });

    const generatedText = response.text();

    res.json({
      success: true,
      result: {
        content: generatedText,
        prompt,
        type: type || "text",
        timestamp: new Date().toLocaleTimeString(),
      },
    });
  } catch (error) {
    console.error("Gemini API Error:", error);
    res.status(500).json({
      error:
        error.message || "Произошла ошибка при обращении к Google AI Studio",
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "AI Backend is running" });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log("🔐 Google OAuth Config:");
  console.log(
    `   CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? "✓ Set" : "✗ Missing"}`,
  );
  console.log(
    `   CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? "✓ Set" : "✗ Missing"}`,
  );
  console.log(`   CALLBACK_URL: ${process.env.SERVER_URL}/auth/callback`);
});
