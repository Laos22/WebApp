import express from "express";
import passport from "passport";

const router = express.Router();

/**
 * Начало OAuth процесса
 */
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email", "https://www.googleapis.com/auth/drive.file"],
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
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  } else {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  }
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
