// server/src/routes/projectRoutes.js
import express from "express";
import { ensureAuthenticated } from "../middleware/auth.js";
import Settings from "../models/Settings.js";
import { generateVideoTopic } from "../services/geminiService.js";

const router = express.Router();

router.post("/generate-topic", ensureAuthenticated, async (req, res) => {
  try {
    const { keywords } = req.body; // 👈 Принимаем ключевые слова

    const settings = await Settings.findOne({ userId: req.user._id });

    if (!settings?.systemPrompt) {
      return res.status(400).json({
        error: "Системный промпт не найден. Установите его в настройках.",
      });
    }

    // Передаем и системный промпт, и ключевые слова
    const generatedTopic = await generateVideoTopic(settings.systemPrompt, keywords);

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