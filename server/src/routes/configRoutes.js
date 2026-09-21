import express from "express";
import { ensureAuthenticated } from "../middleware/auth.js";
import Settings, { DEFAULT_SYSTEM_PROMPT, DEFAULT_VIDEO_PROMPT_PREPARATION_PROMPT, DEFAULT_VISUAL_BIBLE_PROMPT, DEFAULT_VISUAL_BIBLE_EDIT_PROMPT, DEFAULT_VISUAL_REFERENCE_PROMPT, DEFAULT_REFERENCE_ANALYSIS_PROMPT, DEFAULT_REFERENCE_DETAIL_PROMPT, DEFAULT_STORYBOARD_PROMPT, DEFAULT_STORYBOARD_DETAIL_PROMPT, DEFAULT_AUDIO_ADAPTATION_PROMPT } from "../models/Settings.js";
import {
  encryptData,
  decryptData,
  maskSecret,
} from "../services/encryptionService.js";
import { getDriveConnectionStatus } from "../services/driveTokenService.js";
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
      prompts: {
        ...(settings.prompts || {
          theme: "",
          script: "",
          cover: "",
          audio: "",
          timelineDavinci: "",
        }),
        visualBiblePrompt: settings.prompts?.visualBiblePrompt ?? DEFAULT_VISUAL_BIBLE_PROMPT,
        visualBibleEditPrompt: settings.prompts?.visualBibleEditPrompt ?? DEFAULT_VISUAL_BIBLE_EDIT_PROMPT,
        visualReferencePrompt: settings.prompts?.visualReferencePrompt ?? DEFAULT_VISUAL_REFERENCE_PROMPT,
        referenceAnalysisPrompt: settings.prompts?.referenceAnalysisPrompt || DEFAULT_REFERENCE_ANALYSIS_PROMPT,
        referenceDetailPrompt: settings.prompts?.referenceDetailPrompt || DEFAULT_REFERENCE_DETAIL_PROMPT,
        storyboardPrompt: settings.prompts?.storyboardPrompt || DEFAULT_STORYBOARD_PROMPT,
        storyboardDetailPrompt: settings.prompts?.storyboardDetailPrompt || DEFAULT_STORYBOARD_DETAIL_PROMPT,
        videoPromptPreparationPrompt: settings.prompts?.videoPromptPreparationPrompt ?? DEFAULT_VIDEO_PROMPT_PREPARATION_PROMPT,
        audio: settings.prompts?.audio || DEFAULT_AUDIO_ADAPTATION_PROMPT,
      },
      driveConnected: await getDriveConnectionStatus(req.user._id),
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
    const body = req.body;
    const promptFields = ["theme", "script", "cover", "audio", "timelineDavinci", "visualBiblePrompt", "visualBibleEditPrompt", "visualReferencePrompt", "referenceAnalysisPrompt", "referenceDetailPrompt", "storyboardPrompt", "storyboardDetailPrompt", "videoPromptPreparationPrompt"];
    const optionalPromptFields = ["visualBiblePrompt", "visualBibleEditPrompt", "visualReferencePrompt", "referenceAnalysisPrompt", "referenceDetailPrompt", "storyboardPrompt", "storyboardDetailPrompt", "videoPromptPreparationPrompt"];

    if (
      !body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "prompts")
    ) {
      return res.status(400).json({ error: "Разрешено только поле prompts" });
    }

    const { prompts } = body;
    if (
      !prompts || typeof prompts !== "object" || Array.isArray(prompts) ||
      Object.keys(prompts).some((key) => !promptFields.includes(key)) ||
      promptFields.some((key) =>
        optionalPromptFields.includes(key) && !Object.hasOwn(prompts, key)
          ? false
          : !Object.hasOwn(prompts, key) || typeof prompts[key] !== "string"
      )
    ) {
      return res.status(400).json({
        error: "Некорректные настройки промптов",
      });
    }

    let settings = await Settings.findOne({ userId: req.user._id });

    if (!settings) {
      settings = new Settings({ userId: req.user._id });
    }

    // Копируем только разрешённые поля текущего frontend.
    settings.prompts = Object.fromEntries(promptFields.map((key) => [
      key,
      optionalPromptFields.includes(key) && !Object.hasOwn(prompts, key)
        ? settings.prompts?.[key] ?? ({ videoPromptPreparationPrompt: DEFAULT_VIDEO_PROMPT_PREPARATION_PROMPT, visualBiblePrompt: DEFAULT_VISUAL_BIBLE_PROMPT, visualBibleEditPrompt: DEFAULT_VISUAL_BIBLE_EDIT_PROMPT, visualReferencePrompt: DEFAULT_VISUAL_REFERENCE_PROMPT, referenceAnalysisPrompt: DEFAULT_REFERENCE_ANALYSIS_PROMPT, referenceDetailPrompt: DEFAULT_REFERENCE_DETAIL_PROMPT, storyboardPrompt: DEFAULT_STORYBOARD_PROMPT, storyboardDetailPrompt: DEFAULT_STORYBOARD_DETAIL_PROMPT }[key])
        : prompts[key],
    ]));

    settings.updatedAt = new Date();
    await settings.save();

    // Синхронизация с Drive
    syncToDrive(settings).then(async (result) => {
      if (result.success && result.fileId && result.fileId !== settings.driveFileId) {
        settings.driveFileId = result.fileId;
        await settings.save(); // Сохраняем ID файла в БД
      }
    }).catch(() => console.error("DRIVE_SYNC_PERSIST_FAILED"));

    res.json({
      success: true,
      prompts: Object.fromEntries(promptFields.map((key) => [key, settings.prompts[key]])),
      driveConnected: await getDriveConnectionStatus(req.user._id),
    });
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

  // Preserve hasApiKey=false for damaged keys without exposing decryption errors.
  let decrypted = null;
  try {
    decrypted = apiKey ? decryptData(apiKey) : null;
  } catch {
    // A damaged profile must not break the profiles endpoint.
  }

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
  syncToDrive(settings).then(async (result) => {
    if (result?.success && result.fileId && result.fileId !== settings.driveFileId) {
      settings.driveFileId = result.fileId;
      await settings.save();
    }
  }).catch(() => console.error("DRIVE_SYNC_PERSIST_FAILED"));
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
