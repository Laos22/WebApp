import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import session from "express-session";
import MongoStore from "connect-mongo";
import passport from "passport";
import passportGoogle from "passport-google-oauth20";
import { GoogleGenAI } from "@google/genai";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";
import connectDB from "./src/config/database.js";
import authRoutes from "./src/routes/authRoutes.js";
import configRoutes from "./src/routes/configRoutes.js";
import projectRoutes from "./src/routes/projectRoutes.js";
import { ensureAuthenticated } from "./src/middleware/auth.js";
import User from "./src/models/User.js";
import Settings from "./src/models/Settings.js";
import { saveDriveTokens } from "./src/services/driveTokenService.js";
import {
  authMode,
  clientOrigins,
  googleAllowedEmails,
  isGoogleAuth,
  isGoogleDriveStorage,
  storageProvider,
  validateRuntimeConfig,
} from "./src/config/runtimeConfig.js";

const GoogleStrategy = passportGoogle.Strategy;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, "../client/dist");

const app = express();
const PORT = process.env.PORT || 5001;
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;
const sessionMaxAge = 1000 * 60 * 60 * 24 * 7;
const runtime = validateRuntimeConfig();
const allowedOrigins = clientOrigins();
const allowedGoogleEmails = googleAllowedEmails();

if (!sessionSecret || sessionSecret.trim().length < 32) {
  console.error("Ошибка конфигурации: SESSION_SECRET должен содержать минимум 32 символа. Запуск остановлен.");
  process.exit(1);
}

if (isProduction) {
  // Deployment must route requests through one trusted reverse proxy.
  app.set("trust proxy", 1);
}

// Логируем АБСОЛЮТНО все входящие запросы для диагностики
morgan.token("safe-url", (req) => req.path);
app.use(morgan(":method :safe-url :status :response-time :res[content-length] - :remote-addr :remote-user :date[iso8601]"));

if (!isProduction) {
  app.use((req, res, next) => {
    console.log(`[DEBUG] ${req.method} ${req.path}`);
    next();
  });
}

// Подключаем базу данных
await connectDB();

// Middleware
console.log("CORS origins:", allowedOrigins.join(", "));
app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) return callback(null, true);
    return callback(new Error("CORS_ORIGIN_NOT_ALLOWED"));
  },
  credentials: true,
}));
// A storyboard can contain up to 200 detailed prompts. Express defaults to
// 100 KB, which is too small for a legitimate full-board save.
app.use(express.json({ limit: "12mb" }));

// Сессии
app.use(
  session({
    secret: sessionSecret,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      ttl: sessionMaxAge / 1000,
    }),
    resave: false,
    saveUninitialized: false,
    name: "aihub.sid",
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: process.env.SESSION_COOKIE_SAME_SITE || "lax",
      maxAge: sessionMaxAge, // 7 дней
    },
  }),
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Настройка Google Strategy
if (isGoogleAuth || isGoogleDriveStorage) passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.VITE_SERVER_URL}/auth/callback`,
      passReqToCallback: true,
      state: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email = String(profile.emails?.[0]?.value || "").trim().toLowerCase();
        if (!email || (allowedGoogleEmails.length > 0 && !allowedGoogleEmails.includes(email))) {
          console.warn("OAUTH_EMAIL_NOT_ALLOWED");
          return done(new Error("Google account is not allowed"), null);
        }
        console.log("👤 Google Profile получен:", {
          id: profile.id,
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
            email,
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
          // Ensure the owner's Settings exists; credentials are written only by the service.
          await Settings.updateOne(
            { userId: user._id },
            { $setOnInsert: { userId: user._id } },
            { upsert: true, setDefaultsOnInsert: true },
          );
          await saveDriveTokens({
            userId: user._id,
            incomingTokens: {
              access_token: accessToken,
              refresh_token: refreshToken,
              // This Passport callback has no exact expiry; retain the existing one-hour estimate.
              expiry_date: Date.now() + 60 * 60 * 1000,
            },
          });
          console.log("DRIVE_CREDENTIALS_SAVED");
        }

        done(null, user);
      } catch {
        console.error("OAUTH_CREDENTIALS_FAILED");
        done(new Error("Unable to complete Google authentication"), null);
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
app.use("/api/projects", projectRoutes);

// Эндпоинт генерации контента
app.post("/api/generate", ensureAuthenticated, async (req, res) => {
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
  res.json({
    status: "ok",
    message: "AI Backend is running",
    authMode,
    storageProvider,
    buildCommit: /^[0-9a-f]{40}$/i.test(process.env.RENDER_GIT_COMMIT || '')
      ? process.env.RENDER_GIT_COMMIT : null,
    davinciExportVersion: 2,
  });
});

// Body-parser errors otherwise become an HTML page, which the React client
// cannot interpret as an API response.
app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      error: "Раскадровка слишком большая для сохранения одним запросом.",
      code: "JSON_BODY_TOO_LARGE",
    });
  }
  if (error instanceof SyntaxError && error?.status === 400 && Object.hasOwn(error, "body")) {
    return res.status(400).json({ error: "Некорректный JSON в запросе", code: "INVALID_JSON_BODY" });
  }
  return next(error);
});

// Render runs the API and the built React client as one web service. Keeping
// both on one origin avoids cross-site cookie issues in browsers and on phones.
if (isProduction) {
  app.use(express.static(clientDistPath, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/") || req.path.startsWith("/auth/")) {
      return next();
    }
    return res.sendFile(path.join(clientDistPath, "index.html"), error => {
      if (error) next(error);
    });
  });
}

const server = app.listen(PORT, () => {
  console.log(`Server is running on ${process.env.VITE_SERVER_URL}`);
  console.log(`Runtime: auth=${runtime.authMode}, storage=${runtime.storageProvider}`);
  console.log("🔐 Google OAuth Config:");
  console.log(
    `   CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? "✓ Set" : "✗ Missing"}`,
  );
  console.log(
    `   CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? "✓ Set" : "✗ Missing"}`,
  );
  console.log(`   CALLBACK_URL: ${process.env.VITE_SERVER_URL}/auth/callback`);
});

// Убрали сложный gracefulShutdown, чтобы не конфликтовать с nodemon
