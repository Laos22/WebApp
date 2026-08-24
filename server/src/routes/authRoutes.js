import express from "express";
import passport from "passport";
import { google } from "googleapis";
import { saveTokens, getStoredTokens } from "../services/driveSync.js";
import Settings from "../models/Settings.js";

const router = express.Router();

/**
 * Начало OAuth процесса
 */
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["https://www.googleapis.com/auth/drive.file"],
    access_type: "offline",
    prompt: "consent",
  }),
);
/**
 * Callback от Google
 */
router.get(
  "/callback",
  passport.authenticate("google", {
    failureRedirect: `${process.env.CLIENT_URL}/login?error=true`,
  }),
  (req, res) => {
    // Успешная авторизация
    res.redirect(`${process.env.CLIENT_URL}/?auth=success`);
  },
);
/**
 * Выход из системы
 */
router.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect(process.env.CLIENT_URL || "http://localhost:5173");
  });
});

/**
 * Проверка статуса авторизации
 */
router.get("/status", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        id: req.user._id,
        email: req.user.email,
        displayName: req.user.displayName,
        picture: req.user.picture,
      },
    });
  } else {
    res.json({ authenticated: false });
  }
});

export default router;
