import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import { GoogleStrategy } from "passport-google-oauth20";
import { GoogleGenAI } from "@google/genai";
import connectDB from "./src/config/database.js";
import authRoutes from "./src/routes/authRoutes.js";
import configRoutes from "./src/routes/configRoutes.js";
import User from "./src/models/User.js";
import Settings from "./src/models/Settings.js";
import { encryptData, decryptData } from "./src/services/encryptionService.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Подключаем базу данных
connectDB();

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
    },
    (accessToken, refreshToken, profile, done) => {
      User.findOne({ googleId: profile.id })
        .then((existingUser) => {
          if (existingUser) {
            return done(null, existingUser);
          }

          const newUser = new User({
            googleId: profile.id,
            email: profile.emails[0].value,
            displayName: profile.displayName,
            picture: profile.photos[0]?.value,
          });

          return newUser.save().then((user) => done(null, user));
        })
        .catch((err) => done(err, null));
    },
  ),
);

// Сериализация сессии
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findById(id)
    .then((user) => done(null, user))
    .catch((err) => done(err, null));
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
});
