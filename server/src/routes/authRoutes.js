import express from "express";
import { google } from "googleapis";
import { saveTokens, getStoredTokens } from "../services/driveSync.js";

const router = express.Router();

// Функция для получения клиента (чтобы переменные .env точно подгрузились)
const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.SERVER_URL}/auth/callback`,
  );
};

/**
 * Начало OAuth процесса
 */
router.get("/google", (req, res) => {
  const oauth2Client = getOAuth2Client();
  const scopes = ["https://www.googleapis.com/auth/drive.file"];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent", // Показывать окно согласия каждый раз
  });

  res.redirect(authUrl);
});

/**
 * Callback от Google
 */
router.get("/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "Authorization code not found" });
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    console.log("📝 Полученные токены:", {
      access_token: tokens.access_token ? "✓ есть" : "✗ нет",
      refresh_token: tokens.refresh_token ? "✓ есть" : "✗ нет",
      scope: tokens.scope,
      expiry_date: tokens.expiry_date,
    });

    saveTokens(tokens);

    res.redirect(`${process.env.CLIENT_URL}/?drive=connected`);
  } catch (e) {
    console.error("❌ Ошибка при получении токенов:", e);
    res.status(500).json({ error: "Failed to authenticate" });
  }
});

/**
 * Проверка статуса подключения
 */
router.get("/status", (req, res) => {
  const tokens = getStoredTokens();
  res.json({
    connected: !!tokens,
    hasRefreshToken: tokens?.refresh_token ? true : false,
  });
});

export default router;
