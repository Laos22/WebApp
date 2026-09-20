import express from "express";
import passport from "passport";
import { ensureAuthenticated } from "../middleware/auth.js";

const router = express.Router();
const sessionCookieName = "aihub.sid";
const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.SESSION_COOKIE_SAME_SITE || "lax",
};

export const googleAuthorizationOptions = Object.freeze({
  scope: ["profile", "email", "https://www.googleapis.com/auth/drive.file"],
  // passport-google-oauth20 expects camelCase here and converts it to
  // Google's access_type query parameter.
  accessType: "offline",
  prompt: "consent",
});

/**
 * Начало OAuth процесса
 */
router.get(
  "/google",
  passport.authenticate("google", googleAuthorizationOptions),
);

/**
 * Callback от Google
 */
router.get(
  "/callback",
  passport.authenticate("google", {
    failureRedirect: `${process.env.VITE_CLIENT_URL}/login?error=true`,
  }),
  (req, res) => {
    res.redirect(`${process.env.VITE_CLIENT_URL}/?auth=success`);
  },
);

/**
 * Выход из системы
 */
router.post("/logout", (req, res, next) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error("❌ Ошибка при уничтожении сессии:", err);
        return res
          .status(500)
          .json({ success: false, error: "Ошибка при выходе из системы" });
      }
      res.clearCookie(sessionCookieName, sessionCookieOptions);
      res.json({ success: true });
    });
  } else {
    res.clearCookie(sessionCookieName, sessionCookieOptions);
    res.json({ success: true });
  }
});

/**
 * Проверка статуса авторизации
 */
router.get("/status", ensureAuthenticated, (req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.displayName,
      picture: req.user.picture,
    },
  });
});

export default router;
