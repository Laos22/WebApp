import express from "express";
import { ensureAuthenticated } from "../middleware/auth.js";
import Settings from "../models/Settings.js";
import { encryptData, decryptData } from "../services/encryptionService.js";
import { syncToDrive } from "../services/driveSync.js";

const router = express.Router();

/**
 * Получить настройки текущего пользователя
 */
router.get("/", ensureAuthenticated, async (req, res) => {
  try {
    let settings = await Settings.findOne({ userId: req.user._id });

    if (!settings) {
      // Создаем дефолтные настройки для нового пользователя
      settings = new Settings({
        userId: req.user._id,
        apiKey: "",
        systemPrompt:
          "Ты — профессиональный YouTube-сценарист. Твоя задача — создавать виральные сценарии.",
      });
      await settings.save();
    }

    res.json({
      apiKey: settings.apiKey || "",
      systemPrompt: settings.systemPrompt || "",
      driveConnected: !!settings.driveTokens,
      driveFileId: settings.driveFileId || null,
    });
  } catch (error) {
    console.error("Ошибка получения настроек:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

/**
 * Обновить настройки текущего пользователя
 */
router.post("/", ensureAuthenticated, async (req, res) => {
  try {
    const { apiKey, systemPrompt, driveTokens, driveFileId } = req.body;

    let settings = await Settings.findOne({ userId: req.user._id });

    if (!settings) {
      settings = new Settings({ userId: req.user._id });
    }

    // Обновляем поля
    if (apiKey !== undefined) settings.apiKey = apiKey;
    if (systemPrompt !== undefined) settings.systemPrompt = systemPrompt;
    if (driveTokens !== undefined) settings.driveTokens = driveTokens;
    if (driveFileId !== undefined) settings.driveFileId = driveFileId;

    settings.updatedAt = new Date();
    await settings.save();

    // Синхронизация с Drive
    syncToDrive(settings).then(result => {
        if (result.success && result.fileId !== settings.driveFileId) {
            settings.driveFileId = result.fileId;
            settings.save(); // Сохраняем ID файла в БД
        }
    });

    res.json({ success: true, settings });
  } catch (error) {
    console.error("Ошибка обновления настроек:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

/**
 * Получить только системный промпт
 */
router.get("/prompt", ensureAuthenticated, async (req, res) => {
  try {
    const settings = await Settings.findOne({ userId: req.user._id });
    res.json({
      systemPrompt:
        settings?.systemPrompt || "Ты — профессиональный YouTube-сценарист.",
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch prompt" });
  }
});

export default router;

