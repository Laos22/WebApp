import express from "express";
import { ensureAuthenticated } from "../middleware/auth.js";
import Settings, { DEFAULT_SYSTEM_PROMPT } from "../models/Settings.js";
import {
  encryptData,
  decryptData,
  maskSecret,
} from "../services/encryptionService.js";
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
        prompts: {
          theme: "",
          script: "",
          cover: "",
          audio: "",
          timelineDavinci: "",
        },
      });
      await settings.save();
    }

    res.json({
      prompts: settings.prompts || {
        theme: "",
        script: "",
        cover: "",
        audio: "",
        timelineDavinci: "",
      },
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
    const { prompts, driveTokens, driveFileId } = req.body;

    let settings = await Settings.findOne({ userId: req.user._id });

    if (!settings) {
      settings = new Settings({ userId: req.user._id });
    }

    // Обновляем поля
    if (prompts !== undefined) settings.prompts = prompts;
    if (driveTokens !== undefined) settings.driveTokens = driveTokens;
    if (driveFileId !== undefined) settings.driveFileId = driveFileId;

    settings.updatedAt = new Date();
    await settings.save();

    // Синхронизация с Drive
    syncToDrive(settings).then((result) => {
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

/* ==========================================================================
 * CRUD ПРОФИЛЕЙ AI-ПРОВАЙДЕРОВ
 *
 * ПРИНЦИП БЕЗОПАСНОСТИ: apiKey шифруется в БД и НИКОГДА не покидает
 * бэкенд в открытом виде. На фронт отдаём только маску (`••••1a2b`)
 * и флаг hasApiKey. Реальный ключ расшифровывается только в момент
 * фактического вызова внешнего API (см. getDecryptedApiKey в aiProfileResolver).
 * ========================================================================== */

/**
 * Приводит документ профиля к безопасному виду для фронтенда.
 * apiKey заменяется маской; сырой зашифрованный ключ вырезается из ответа.
 */
const serializeProfile = (profile) => {
  const obj = profile.toObject ? profile.toObject() : profile;
  const { apiKey, ...safe } = obj;

  // Для маски нужен расшифрованный хвост ключа. Если значение битое,
  // decryptData вернёт null → hasApiKey=false, но эндпоинт не упадёт.
  const decrypted = apiKey ? decryptData(apiKey) : null;

  return {
    ...safe,
    id: obj._id?.toString() ?? obj.id ?? null,
    hasApiKey: Boolean(decrypted),
    apiKeyMask: maskSecret(decrypted),
  };
};

/**
 * Фоновая синхронизация с Google Drive (fire-and-forget).
 * Повторяет логику сохранения driveFileId из POST "/".
 */
const persistAndSyncDrive = (settings) => {
  syncToDrive(settings).then((result) => {
    if (result?.success && result.fileId !== settings.driveFileId) {
      settings.driveFileId = result.fileId;
      settings.save();
    }
  });
};

/**
 * Гарантирует, что для одного пользователя существует документ Settings.
 */
const getOrCreateSettings = async (userId) => {
  let settings = await Settings.findOne({ userId });
  if (!settings) {
    settings = new Settings({ userId, profiles: [] });
    await settings.save();
  }
  return settings;
};

/**
 * Если профиль помечен как дефолтный — снимаем флаг с остальных
 * профилей ТОГО ЖЕ типа (текст/картинка/звук независимы).
 */
const enforceSingleDefault = (settings, type, exceptId = null) => {
  settings.profiles.forEach((p) => {
    if (p.type === type && p._id?.toString() !== exceptId) {
      p.isDefault = false;
    }
  });
};

/**
 * Список профилей текущего пользователя
 */
router.get("/profiles", ensureAuthenticated, async (req, res) => {
  try {
    const settings = await getOrCreateSettings(req.user._id);
    res.json(settings.profiles.map(serializeProfile));
  } catch (error) {
    console.error("Ошибка получения профилей:", error);
    res.status(500).json({ error: "Failed to fetch profiles" });
  }
});

/**
 * Создать новый профиль
 */
router.post("/profiles", ensureAuthenticated, async (req, res) => {
  try {
    const { name, type, provider, apiKey } = req.body;

    if (!name?.trim() || !type || !provider || !apiKey?.trim()) {
      return res
        .status(400)
        .json({ error: "Обязательные поля: name, type, provider, apiKey" });
    }

    const settings = await getOrCreateSettings(req.user._id);

    // Собираем документ профиля: apiKey шифруем, id пришедший с фронта игнорируем
    const { id, _id, apiKey: rawKey, ...rest } = req.body;
    settings.profiles.push({ ...rest, apiKey: encryptData(rawKey.trim()) });

    const created = settings.profiles[settings.profiles.length - 1];
    if (created.isDefault) {
      enforceSingleDefault(settings, created.type, created._id?.toString());
    }

    await settings.save();
    persistAndSyncDrive(settings);

    res.status(201).json(serializeProfile(created));
  } catch (error) {
    console.error("Ошибка создания профиля:", error);
    res.status(500).json({ error: "Failed to create profile" });
  }
});

/**
 * Обновить существующий профиль
 */
router.put("/profiles/:id", ensureAuthenticated, async (req, res) => {
  try {
    const settings = await getOrCreateSettings(req.user._id);
    const profile = settings.profiles.id(req.params.id);

    if (!profile) {
      return res.status(404).json({ error: "Профиль не найден" });
    }

    const { id, _id, apiKey, ...rest } = req.body;

    // Применяем скалярные и вложенные поля
    Object.assign(profile, rest);

    // apiKey перешифровываем только если он реально пришёл непустым
    if (apiKey?.trim()) {
      profile.apiKey = encryptData(apiKey.trim());
    }

    if (profile.isDefault) {
      enforceSingleDefault(settings, profile.type, profile._id.toString());
    }

    await settings.save();
    persistAndSyncDrive(settings);

    res.json(serializeProfile(profile));
  } catch (error) {
    console.error("Ошибка обновления профиля:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

/**
 * Удалить профиль
 */
router.delete("/profiles/:id", ensureAuthenticated, async (req, res) => {
  try {
    const settings = await getOrCreateSettings(req.user._id);
    const profile = settings.profiles.id(req.params.id);

    if (!profile) {
      return res.status(404).json({ error: "Профиль не найден" });
    }

    profile.deleteOne();
    await settings.save();
    persistAndSyncDrive(settings);

    res.json({ success: true, id: req.params.id });
  } catch (error) {
    console.error("Ошибка удаления профиля:", error);
    res.status(500).json({ error: "Failed to delete profile" });
  }
});

export default router;
