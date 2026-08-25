// server/src/routes/projectRoutes.js
import express from "express";
import { ensureAuthenticated } from "../middleware/auth.js";
import Settings from "../models/Settings.js";
import { generateVideoTopic } from "../services/geminiService.js";

const router = express.Router();

router.post("/generate-topic", ensureAuthenticated, async (req, res) => {
  try {
    console.log("🔍 [DEBUG] Запрос получен, пользователь:", req.user?._id);
    
    const settings = await Settings.findOne({ userId: req.user._id });
    console.log("🔍 [DEBUG] Settings:", settings);

    if (!settings?.systemPrompt) {
      return res.status(400).json({
        error: "Системный промпт не найден. Установите его в настройках.",
      });
    }

    console.log("🔍 [DEBUG] Отправляем systemPrompt в Gemini...");
    const generatedTopic = await generateVideoTopic(settings.systemPrompt);

    res.json({
      success: true,
      topic: generatedTopic,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Ошибка генерации темы:", error);
    res.status(500).json({
      error: error.message || "Ошибка при генерации темы видео",
    });
  }
});

export default router;