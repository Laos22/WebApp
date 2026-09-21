// server/src/routes/projectRoutes.js
import express from "express";
import multer from "multer";
import JSZip from "jszip";
import { ensureAuthenticated } from "../middleware/auth.js";
import Settings, { DEFAULT_VISUAL_BIBLE_PROMPT, DEFAULT_VISUAL_BIBLE_EDIT_PROMPT, DEFAULT_REFERENCE_ANALYSIS_PROMPT, DEFAULT_REFERENCE_DETAIL_PROMPT, DEFAULT_STORYBOARD_PROMPT, DEFAULT_STORYBOARD_DETAIL_PROMPT, DEFAULT_AUDIO_ADAPTATION_PROMPT } from "../models/Settings.js";
import {
  generateVideoTopic,
  generateCoverData,
  generateScript,
  editScript,
  generateVisualBibleDraft,
  editVisualBible,
  analyzeScriptReferences,
  detailReferencePrompt,
  generateStoryboard,
  detailStoryboardFramePrompt,
  generateVoiceoverAdaptation,
} from "../services/geminiService.js";
import {
  resolveProfile,
  logProfileUsage,
} from "../services/aiProfileResolver.js";
import Project from "../models/Project.js";
import VisualReference from "../models/VisualReference.js";
import StoryboardImage from "../models/StoryboardImage.js";
import {
  normalizeVisualBible, validateVisualBibleContent, markVisualBibleStaleUpdate,
  normalizeGeneratedVisualBible,
  normalizeEditedVisualBible,
} from "../services/visualBibleService.js";
import {
  MAX_VISUAL_REFERENCE_BYTES, saveVisualReferenceFile, readVisualReferenceFile,
  deleteVisualReferenceFile, detectImageFormat,
} from "../services/visualReferenceStorage.js";
import {
  normalizeReferencePlan, parseReferenceAnalysis, validateReferenceItems,
} from "../services/referencePlanService.js";
import {
  normalizeStoryboard, parseGeneratedStoryboard, storyboardEditableFrame, storyboardIsCurrent,
  storyboardImageMatchesFrame, validateStoryboardFrames,
} from "../services/storyboardService.js";
import {
  splitScenarioBlocks, parseAdaptedBlocks, normalizeVoiceover,
  validateManualVoiceoverBlocks, voiceoverIsCurrent,
} from "../services/voiceoverService.js";
import { synthesizeElevenLabs } from "../services/elevenLabsService.js";
import { saveVoiceoverAudio, readVoiceoverAudio, deleteVoiceoverAudio } from "../services/voiceoverStorage.js";
import { generateGoogleStoryboardImage } from "../services/googleImageService.js";
import {
  saveStoryboardImageFile, readStoryboardImageFile, deleteStoryboardImageFile, storyboardFrameFileBase,
  commitStoryboardImageFile, rollbackStoryboardImageFile, createStoryboardImagePreview,
} from "../services/storyboardImageStorage.js";
import {
  deleteProjectWorkspace,
  initializeProjectStorage,
  projectUsesDrive,
  updateProjectState,
  writeProjectState,
  writeProjectTextFile,
} from "../services/projectStorageGateway.js";
import {
  buildFlowManifest, flowFrameBaseName, flowPromptsText, flowReferenceFileName,
  frameIdFromFlowImagePath,
} from "../services/flowPackageService.js";
import path from "path";
import fs from "fs";

const router = express.Router();
const configuredFlowArchiveMb = Number(process.env.MAX_FLOW_ARCHIVE_MB || 100);
const maxFlowArchiveBytes = Math.min(
  250,
  Number.isFinite(configuredFlowArchiveMb) && configuredFlowArchiveMb > 0 ? configuredFlowArchiveMb : 100,
) * 1024 * 1024;
const visualReferenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VISUAL_REFERENCE_BYTES, files: 1, fields: 3, parts: 4 },
});
const flowArchiveUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFlowArchiveBytes, files: 1, fields: 3, parts: 4 },
});
const flowFrameImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 2, parts: 3 },
});

function parseVisualReferenceUpload(req, res, next) {
  visualReferenceUpload.single("image")(req, res, error => {
    if (!error) return next();
    return res.status(error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
      .json({ error: "Некорректный файл референса" });
  });
}

function parseFlowArchiveUpload(req, res, next) {
  flowArchiveUpload.single("archive")(req, res, error => {
    if (!error) return next();
    const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json(tooLarge ? {
      error: `Архив превышает серверный лимит ${configuredFlowArchiveMb} МБ. Используйте последовательный импорт изображений.`,
      code: "FLOW_ARCHIVE_TOO_LARGE",
      maxArchiveMb: configuredFlowArchiveMb,
    } : { error: "Некорректный архив результатов Flow" });
  });
}

function parseFlowFrameImageUpload(req, res, next) {
  flowFrameImageUpload.single("image")(req, res, error => {
    if (!error) return next();
    return res.status(error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
      .json({ error: "Некорректное изображение Flow" });
  });
}

function visualReferenceMetadata(reference, item) {
  return {
    id: reference._id.toString(), referenceId: reference.referenceId,
    sourceReferenceVersion: reference.sourceReferenceVersion, status: reference.status,
    mimeType: reference.mimeType, byteSize: reference.byteSize, prompt: reference.prompt,
    errorCode: reference.errorCode, createdAt: reference.createdAt, updatedAt: reference.updatedAt,
    stale: !item || reference.sourceReferenceVersion !== item.version,
  };
}

function parseVisualReferenceVersion(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

// Существующий route для генерации темы
router.post("/generate-topic", ensureAuthenticated, async (req, res) => {
  try {
    const { keywords } = req.body;

    const settings = await Settings.findOne({ userId: req.user._id });

    if (!settings?.systemPrompt) {
      return res.status(400).json({
        error: "Системный промпт не найден. Установите его в настройках.",
      });
    }

    // Выбираем дефолтный текстовый профиль и логируем, что именно применяется
    const textProfile = resolveProfile(settings, "text");
    logProfileUsage("generate-topic", textProfile, "text");

    const generatedTopic = await generateVideoTopic(
      settings.systemPrompt,
      keywords,
      textProfile,
    );

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

// 👈 НОВЫЙ Route: Получение всех проектов пользователя
router.get("/", ensureAuthenticated, async (req, res) => {
  try {
    const projects = await Project.find({ userId: req.user._id }).sort({
      updatedAt: -1,
    });
    res.json({ success: true, projects });
  } catch (error) {
    console.error("❌ Ошибка получения проектов:", error);
    res.status(500).json({ error: "Ошибка при получении списка проектов" });
  }
});

// GET проект по ID
router.get("/:id", ensureAuthenticated, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ error: "Ошибка при получении проекта" });
  }
});

// DELETE проект
router.delete("/:id", ensureAuthenticated, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    const references = await VisualReference.find({ projectId: project._id, userId: req.user._id })
      .select("+storageKey");
    const storyboardImages = await StoryboardImage.find({ projectId: project._id, userId: req.user._id })
      .select("+storageKey");

    await deleteProjectWorkspace({ project, userId: req.user._id });

    await project.deleteOne();
    await VisualReference.deleteMany({ projectId: project._id, userId: req.user._id });
    await StoryboardImage.deleteMany({ projectId: project._id, userId: req.user._id });
    await Promise.all(references.map(reference => deleteVisualReferenceFile(reference.storageKey, project.projectPath, req.user._id)
      .catch(() => console.error("VISUAL_REFERENCE_PROJECT_DELETE_FAILED"))));
    await Promise.all(storyboardImages.map(image => deleteStoryboardImageFile(image.storageKey, project.projectPath, req.user._id)
      .catch(() => console.error("STORYBOARD_IMAGE_PROJECT_DELETE_FAILED"))));
    res.json({ success: true, message: "Проект удален" });
  } catch (error) {
    res.status(500).json({ error: "Ошибка при удалении проекта" });
  }
});

// 👈 НОВЫЙ Route: Создание проекта из выбранной темы
router.post("/create-from-topic", ensureAuthenticated, async (req, res) => {
  try {
    const { topic, description, short_title, keywords } = req.body;

    if (!topic || !description) {
      return res.status(400).json({
        error: "Тема и описание темы обязательны",
      });
    }

    const project = new Project({
      userId: req.user._id,
      title: topic,
      description: description,
      shortTitle: short_title,
      keywords: keywords || "",
    });
    const initializedStorage = await initializeProjectStorage({
      title: short_title || topic,
      projectId: project._id.toString(),
      userId: req.user._id,
    });
    project.projectPath = initializedStorage.projectPath;
    project.storage = initializedStorage.storage;
    await project.save();
    await writeProjectState({ project, userId: req.user._id, state: { short_title, topic, description } });

    res.json({
      success: true,
      projectId: project._id,
      shortTitle: short_title,
      storageProvider: project.storage.provider,
      message: "Проект успешно создан",
    });
  } catch (error) {
    console.error("❌ Ошибка создания проекта:", error);
    res.status(500).json({
      error: error.message || "Ошибка при создании проекта",
    });
  }
});

// 👈 НОВЫЙ Route: Генерация данных обложки
router.post("/:id/generate-cover", ensureAuthenticated, async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const project = await Project.findOne({
      _id: projectId,
      userId: req.user._id,
    });

    if (!project) {
      return res.status(404).json({ error: "Проект не найден" });
    }

    const settings = await Settings.findOne({ userId: req.user._id });

    if (!settings?.systemPrompt) {
      return res.status(400).json({
        error: "Системный промпт не найден. Установите его в настройках.",
      });
    }

    // Выбираем дефолтный текстовый профиль и логируем, что именно применяется
    const textProfile = resolveProfile(settings, "text");
    logProfileUsage("generate-cover", textProfile, "text");

    // Генерируем данные обложки
    const coverData = await generateCoverData(
      settings.systemPrompt,
      project.title,
      project.description,
      textProfile,
    );

    await updateProjectState({ project, userId: req.user._id, patch: { coverData } });

    res.json({
      success: true,
      coverData,
      message: "Данные обложки успешно сгенерированы",
    });
  } catch (error) {
    console.error("❌ Ошибка генерации обложки:", error);
    res.status(500).json({
      error: error.message || "Ошибка при генерации данных обложки",
    });
  }
});

// 👈 НОВЫЙ Route: Генерация сценария
router.post("/:id/generate-script", ensureAuthenticated, async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { prompt, projectDescription } = req.body;

    if (!prompt || !projectDescription) {
      return res.status(400).json({
        error: "Промпт и описание проекта обязательны для генерации сценария",
      });
    }

    const project = await Project.findOne({ _id: projectId, userId: req.user._id });
    if (!project) return res.status(404).json({ error: "Проект не найден" });

    const settings = await Settings.findOne({ userId: req.user._id });

    if (!settings?.prompts?.script) {
      return res.status(400).json({
        error: "Системный промпт для сценария не найден. Установите его в настройках.",
      });
    }

    // Генерация сценария
    const script = await generateScript(
      settings.prompts.script,
      projectDescription,
      resolveProfile(settings, "text"),
    );
    if (typeof script !== "string" || !script.trim()) {
      return res.status(502).json({ error: "Получен пустой сценарий" });
    }
    const saved = await Project.findOneAndUpdate(
      { _id: projectId, userId: req.user._id },
      [
        // Pipeline updates are not cast by Mongoose; text is checked above and
        // wrapped in $literal so leading '$' never becomes an expression.
        {
          $set: {
            "script.content": { $literal: script },
            "script.status": "draft",
            "script.generatedAt": new Date(),
            "script.confirmedAt": null,
            updatedAt: new Date(),
            "script.revision": { $add: [{ $ifNull: ["$script.revision", 0] }, 1] },
          },
        },
        markVisualBibleStaleUpdate(),
      ],
      { new: true, updatePipeline: true },
    );
    if (!saved) return res.status(404).json({ error: "Проект не найден" });
    const warning = await mirrorScript(saved, req.user._id);
    res.json({ success: true, script: saved.script.content, savedScript: saved.script, warning });

  } catch (error) {
    console.error("❌ Ошибка генерации сценария:", error);
    res.status(500).json({
      error: error.message || "Ошибка при генерации сценария",
    });
  }
});

// AI editing is a preview only: no Project or legacy-file writes.
router.post("/:id/edit-script", ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["currentScript", "instruction"].includes(key)) ||
        typeof body.currentScript !== "string" || !body.currentScript.trim() || body.currentScript.length > 20000 ||
        typeof body.instruction !== "string" || !body.instruction.trim() || body.instruction.length > 2000) {
      return res.status(400).json({ error: "Нужны текст сценария (до 20 000 символов) и инструкция (до 2 000 символов)." });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    const settings = await Settings.findOne({ userId: req.user._id });
    const content = await editScript(body.currentScript, body.instruction, resolveProfile(settings, "text"));
    res.json({ content });
  } catch {
    res.status(500).json({ error: "Не удалось изменить сценарий с помощью ИИ. Текущий текст сохранён в редакторе. Попробуйте ещё раз." });
  }
});

// MongoDB is authoritative; the legacy file is a best-effort compatibility copy.
async function mirrorScript(project, userId) {
  try {
    if (!projectUsesDrive(project)) {
      if (!project.projectPath) throw new Error("Missing project path");
      const file = path.join(project.projectPath, "project_state.json");
      const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : {};
      state.generatedScript = project.script.content;
      fs.mkdirSync(project.projectPath, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
      fs.mkdirSync(path.join(project.projectPath, "script"), { recursive: true });
      fs.writeFileSync(path.join(project.projectPath, "script", "script.txt"), project.script.content, "utf-8");
      return undefined;
    }
    await updateProjectState({ project, userId, patch: { generatedScript: project.script.content } });
    await writeProjectTextFile({
      project, userId, directory: "script", filename: "script.txt", content: project.script.content,
    });
    return undefined;
  } catch {
    return "Сценарий сохранён в MongoDB, но копию в хранилище обновить не удалось.";
  }
}

router.put("/:id/script", ensureAuthenticated, async (req, res) => {
  try {
    const { content, revision } = req.body;
    if (typeof content !== "string" || !content.trim() || !Number.isInteger(revision) || revision < 1) {
      return res.status(400).json({ error: "Нужны непустой сценарий и его revision" });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    const saved = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, "script.revision": revision },
      [
        { $set: {
          "script.content": { $literal: content }, "script.status": "draft",
          "script.confirmedAt": null, updatedAt: new Date(),
          "script.revision": { $add: ["$script.revision", 1] },
        } },
        markVisualBibleStaleUpdate(),
      ],
      { new: true, updatePipeline: true },
    );
    if (!saved) return res.status(409).json({ error: "Сценарий изменился. Перезагрузите страницу перед сохранением." });
    const warning = await mirrorScript(saved, req.user._id);
    res.json({ success: true, script: saved.script, warning });
  } catch {
    res.status(500).json({ error: "Не удалось сохранить сценарий в MongoDB" });
  }
});

router.post("/:id/script/confirm", ensureAuthenticated, async (req, res) => {
  try {
    const { revision } = req.body;
    if (!Number.isInteger(revision) || revision < 1) {
      return res.status(400).json({ error: "Нужна revision сценария" });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    const saved = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, "script.revision": revision, "script.status": "draft" },
      { $set: { "script.status": "confirmed", "script.confirmedAt": new Date(), updatedAt: new Date() } },
      { new: true, runValidators: true },
    );
    if (!saved) return res.status(409).json({ error: "Сценарий изменился или уже подтверждён. Перезагрузите страницу." });
    const warning = await mirrorScript(saved, req.user._id);
    res.json({ success: true, script: saved.script, warning });
  } catch {
    res.status(500).json({ error: "Не удалось подтвердить сценарий в MongoDB" });
  }
});

function voiceoverResponse(project) {
  const stored = normalizeVoiceover(project);
  return {
    success: true,
    scriptStatus: project.script?.status ?? null,
    scriptRevision: project.script?.revision ?? null,
    voiceoverStatus: project.voiceover?.status ?? 'empty',
    voiceover: {
      ...stored,
      status: stored.status === 'empty' || voiceoverIsCurrent(project, stored) ? stored.status : 'stale',
    },
  };
}

router.get('/:id/voiceover', ensureAuthenticated, async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    return res.json(voiceoverResponse(project));
  } catch {
    return res.status(500).json({ error: 'Не удалось загрузить озвучку' });
  }
});

router.post('/:id/voiceover/adapt', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['instructions', 'expectedEditVersion', 'sourceScriptRevision'].includes(key)) ||
        typeof body.instructions !== 'string' || body.instructions.length > 4000 ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 0 ||
        !Number.isSafeInteger(body.sourceScriptRevision) || body.sourceScriptRevision < 1) {
      return res.status(400).json({ error: 'Некорректные параметры адаптации' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner).select('+voiceover.blocks.audioStorageKey');
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const current = normalizeVoiceover(project);
    if (project.script?.status !== 'confirmed' || project.script.revision !== body.sourceScriptRevision ||
        current.editVersion !== body.expectedEditVersion) {
      return res.status(409).json({ error: 'Сценарий или текст озвучки изменился. Обновите страницу.' });
    }
    const sourceBlocks = splitScenarioBlocks(project.script.content);
    if (!sourceBlocks.length) return res.status(409).json({ error: 'В сценарии не найдены блоки' });
    const settings = await Settings.findOne({ userId: req.user._id });
    const raw = await generateVoiceoverAdaptation(
      project, sourceBlocks, body.instructions.trim(),
      settings?.prompts?.audio || DEFAULT_AUDIO_ADAPTATION_PROMPT,
      resolveProfile(settings, 'text'),
    );
    const previous = (project.voiceover?.blocks || []).map(block => block.toObject?.() ?? block);
    const blocks = parseAdaptedBlocks(raw, sourceBlocks, previous);
    const versionFilter = body.expectedEditVersion === 0
      ? { $or: [{ 'voiceover.editVersion': 0 }, { 'voiceover.editVersion': { $exists: false } }] }
      : { 'voiceover.editVersion': body.expectedEditVersion };
    const saved = await Project.findOneAndUpdate({
      ...owner, 'script.status': 'confirmed', 'script.revision': body.sourceScriptRevision, ...versionFilter,
    }, { $set: {
      voiceover: {
        status: 'draft', revision: current.revision || 0,
        editVersion: body.expectedEditVersion + 1,
        sourceScriptRevision: body.sourceScriptRevision,
        instructions: body.instructions.trim(), blocks,
        updatedAt: new Date(), confirmedAt: null,
      }, updatedAt: new Date(),
    } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Данные изменились во время адаптации. Повторите запрос.' });
    return res.json(voiceoverResponse(saved));
  } catch (error) {
    const known = ['EMPTY_SCRIPT_BLOCK', 'INVALID_AUDIO_ADAPTATION_RESPONSE', 'AUDIO_BLOCK_COUNT_MISMATCH'];
    return res.status(known.includes(error.code) ? 502 : 500).json({
      error: error.code === 'AUDIO_BLOCK_COUNT_MISMATCH'
        ? 'ИИ изменил количество блоков. Адаптация не сохранена; повторите запрос.'
        : error.message || 'Не удалось адаптировать текст', code: error.code,
    });
  }
});

router.put('/:id/voiceover', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['blocks', 'instructions', 'expectedEditVersion'].includes(key)) ||
        typeof body.instructions !== 'string' || body.instructions.length > 4000 ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 1) {
      return res.status(400).json({ error: 'Некорректные данные блоков' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner).select('+voiceover.blocks.audioStorageKey');
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const current = normalizeVoiceover(project);
    if (current.status === 'empty' || current.editVersion !== body.expectedEditVersion || !voiceoverIsCurrent(project, current)) {
      return res.status(409).json({ error: 'Текст озвучки изменился. Обновите страницу.' });
    }
    const rawBlocks = (project.voiceover.blocks || []).map(block => block.toObject?.() ?? block);
    const blocks = validateManualVoiceoverBlocks(body.blocks, rawBlocks);
    const saved = await Project.findOneAndUpdate({
      ...owner, 'voiceover.editVersion': body.expectedEditVersion,
      'script.status': 'confirmed', 'script.revision': current.sourceScriptRevision,
    }, { $set: {
      'voiceover.blocks': blocks, 'voiceover.instructions': body.instructions.trim(),
      'voiceover.status': 'draft', 'voiceover.confirmedAt': null,
      'voiceover.updatedAt': new Date(), updatedAt: new Date(),
    }, $inc: { 'voiceover.editVersion': 1 } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Текст озвучки изменился. Обновите страницу.' });
    return res.json(voiceoverResponse(saved));
  } catch (error) {
    return res.status(error.code === 'INVALID_VOICEOVER_BLOCKS' ? 400 : 500)
      .json({ error: error.code === 'INVALID_VOICEOVER_BLOCKS' ? 'Некорректные блоки озвучки' : 'Не удалось сохранить блоки' });
  }
});

router.post('/:id/voiceover/confirm', ensureAuthenticated, async (req, res) => {
  try {
    const { expectedEditVersion, sourceScriptRevision } = req.body || {};
    if (!Number.isSafeInteger(expectedEditVersion) || expectedEditVersion < 1 ||
        !Number.isSafeInteger(sourceScriptRevision) || sourceScriptRevision < 1) {
      return res.status(400).json({ error: 'Некорректная версия текста' });
    }
    const saved = await Project.findOneAndUpdate({
      _id: req.params.id, userId: req.user._id,
      'script.status': 'confirmed', 'script.revision': sourceScriptRevision,
      'voiceover.status': 'draft', 'voiceover.sourceScriptRevision': sourceScriptRevision,
      'voiceover.editVersion': expectedEditVersion, 'voiceover.blocks.0': { $exists: true },
    }, { $set: {
      'voiceover.status': 'confirmed', 'voiceover.confirmedAt': new Date(),
      'voiceover.updatedAt': new Date(), updatedAt: new Date(),
    }, $inc: { 'voiceover.revision': 1, 'voiceover.editVersion': 1 } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Сохраните актуальный текст перед подтверждением.' });
    return res.json(voiceoverResponse(saved));
  } catch {
    return res.status(500).json({ error: 'Не удалось подтвердить текст озвучки' });
  }
});

router.post('/:id/voiceover/blocks/:blockId/generate', ensureAuthenticated, async (req, res) => {
  try {
    const { expectedEditVersion, textRevision, profileId } = req.body || {};
    if (!Number.isSafeInteger(expectedEditVersion) || expectedEditVersion < 1 ||
        !Number.isSafeInteger(textRevision) || textRevision < 1 ||
        (profileId !== undefined && typeof profileId !== 'string')) {
      return res.status(400).json({ error: 'Некорректные параметры генерации' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner).select('+voiceover.blocks.audioStorageKey');
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const current = normalizeVoiceover(project);
    if (current.editVersion !== expectedEditVersion || !voiceoverIsCurrent(project, current) ||
        !['draft', 'confirmed'].includes(current.status)) {
      return res.status(409).json({ error: 'Текст озвучки изменился. Обновите страницу.' });
    }
    const block = (project.voiceover?.blocks || []).find(item => item.id === req.params.blockId);
    if (!block || block.textRevision !== textRevision) return res.status(409).json({ error: 'Блок изменился. Обновите страницу.' });
    const settings = await Settings.findOne({ userId: req.user._id });
    const requested = profileId ? settings?.profiles?.id(profileId) : null;
    const profile = requested || resolveProfile(settings, 'audio');
    if (!profile || profile.type !== 'audio' || profile.provider !== 'elevenlabs') {
      return res.status(409).json({ error: 'Создайте или выберите профиль «Звук / ElevenLabs».', code: 'ELEVENLABS_PROFILE_REQUIRED' });
    }
    const audio = await synthesizeElevenLabs(block.adaptedText, profile);
    const stored = await saveVoiceoverAudio({
      projectId: project._id.toString(), blockId: block.id, blockOrder: block.order,
      projectPath: project.projectPath, project, userId: req.user._id, buffer: audio,
    });
    const saved = await Project.findOneAndUpdate({
      ...owner, 'voiceover.editVersion': expectedEditVersion,
      'voiceover.blocks': { $elemMatch: { id: block.id, textRevision } },
    }, { $set: {
      'voiceover.blocks.$[block].audioStatus': 'ready',
      'voiceover.blocks.$[block].audioStorageKey': stored.storageKey,
      'voiceover.blocks.$[block].audioMimeType': 'audio/mpeg',
      'voiceover.blocks.$[block].audioByteSize': stored.byteSize,
      'voiceover.blocks.$[block].audioProfileId': profile._id.toString(),
      'voiceover.blocks.$[block].audioGeneratedAt': new Date(),
      'voiceover.blocks.$[block].audioErrorCode': '',
      'voiceover.updatedAt': new Date(), updatedAt: new Date(),
    }, $inc: { 'voiceover.editVersion': 1 } }, {
      new: true, runValidators: true, arrayFilters: [{ 'block.id': block.id, 'block.textRevision': textRevision }],
    });
    if (!saved) return res.status(409).json({ error: 'Блок изменился во время генерации. Повторите запрос.' });
    if (block.audioStorageKey && block.audioStorageKey !== stored.storageKey) {
      deleteVoiceoverAudio(block.audioStorageKey, project.projectPath, req.user._id)
        .catch(() => console.error('VOICEOVER_OLD_FILE_DELETE_FAILED'));
    }
    return res.json(voiceoverResponse(saved));
  } catch (error) {
    const status = error.httpStatus || (error.code === 'ELEVENLABS_AUTH_FAILED' ? 401 :
      error.code === 'ELEVENLABS_LIMIT_REACHED' ? 429 : 502);
    return res.status(status).json({
      error: error.publicMessage || 'Не удалось сгенерировать аудио блока',
      code: error.code,
      ...(Number.isInteger(error.providerStatus) ? { providerStatus: error.providerStatus } : {}),
      ...(Number.isInteger(error.characterCount) ? { characterCount: error.characterCount } : {}),
      ...(Number.isInteger(error.characterLimit) ? { characterLimit: error.characterLimit } : {}),
    });
  }
});

router.get('/:id/voiceover/blocks/:blockId/audio', ensureAuthenticated, async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id })
      .select('+voiceover.blocks.audioStorageKey');
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const block = (project.voiceover?.blocks || []).find(item => item.id === req.params.blockId);
    if (!block?.audioStorageKey || block.audioStatus !== 'ready') return res.status(404).json({ error: 'Аудио не найдено' });
    const audio = await readVoiceoverAudio(block.audioStorageKey, project.projectPath, req.user._id);
    res.set('Content-Type', block.audioMimeType || 'audio/mpeg');
    res.set('Content-Length', String(audio.length));
    res.set('Content-Disposition', `inline; filename="audio_block_${block.order}.mp3"`);
    return res.send(audio);
  } catch {
    return res.status(500).json({ error: 'Не удалось прочитать аудио' });
  }
});

const bibleContentFields = ['visualStyle', 'visualModes', 'continuityRules', 'characters', 'locations', 'objects'];

function validBibleBody(body, action) {
  const allowed = action === 'save'
    ? ['expectedEditVersion', ...bibleContentFields]
    : ['expectedEditVersion', 'sourceScriptRevision'];
  return body && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).every(key => allowed.includes(key)) &&
    Number.isSafeInteger(body.expectedEditVersion) && body.expectedEditVersion >= 0 &&
    (action === 'save' || (Number.isSafeInteger(body.sourceScriptRevision) && body.sourceScriptRevision >= 1));
}

function bibleResponse(project) {
  return {
    success: true, visualBible: normalizeVisualBible(project),
    scriptStatus: project.script?.status ?? null,
    scriptRevision: project.script?.revision ?? null,
  };
}

router.get('/:id/visual-bible', ensureAuthenticated, async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Неверный ID проекта' });
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    return res.json(bibleResponse(project));
  } catch {
    return res.status(500).json({ error: 'Не удалось загрузить Visual Bible' });
  }
});

router.post('/:id/visual-bible/draft', ensureAuthenticated, async (req, res) => {
  try {
    if (!validBibleBody(req.body, 'draft') || req.body.expectedEditVersion === Number.MAX_SAFE_INTEGER) {
      return res.status(400).json({ error: 'Неверные параметры Visual Bible' });
    }
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: 'Проект не найден' });
    const { sourceScriptRevision, expectedEditVersion } = req.body;
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const bible = normalizeVisualBible(project);
    if (project.script?.status !== 'confirmed' || project.script.revision !== sourceScriptRevision ||
        bible.editVersion !== expectedEditVersion) {
      return res.status(409).json({ error: 'Bible или сценарий изменились. Перезагрузите данные.' });
    }
    const settings = await Settings.findOne({ userId: req.user._id });
    const rawText = await generateVisualBibleDraft(
      project.title, project.script.content,
      settings?.prompts?.visualBiblePrompt ?? DEFAULT_VISUAL_BIBLE_PROMPT,
      resolveProfile(settings, 'text'),
    );
    const normalized = normalizeGeneratedVisualBible(rawText);
    let content;
    try {
      // Reuse the existing ceilings and server ID assignment, without accepting AI IDs.
      content = validateVisualBibleContent(normalized);
    } catch {
      return res.status(502).json({ code: 'INVALID_VISUAL_BIBLE_RESPONSE', fields: ['$'] });
    }
    const now = new Date();
    const saved = await Project.findOneAndUpdate({
      ...owner,
      'script.status': 'confirmed',
      'script.revision': sourceScriptRevision,
      ...(expectedEditVersion === 0 ? {
        $or: [
          { 'visualBible.editVersion': 0 },
          { 'visualBible.editVersion': { $exists: false } },
        ],
      } : { 'visualBible.editVersion': expectedEditVersion }),
    }, { $set: {
      visualBible: {
        ...content, status: 'draft', schemaVersion: 1,
        sourceScriptRevision, editVersion: expectedEditVersion + 1,
        revision: bible.revision ?? 0, updatedAt: now, confirmedAt: null,
      },
      updatedAt: now,
    } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Bible или сценарий изменились. Перезагрузите данные.' });
    return res.json(bibleResponse(saved));
  } catch (error) {
    if (error.code === 'INVALID_VISUAL_BIBLE_RESPONSE') {
      return res.status(502).json({ code: error.code, fields: error.fields });
    }
    if (error.code === 'VISUAL_BIBLE_GENERATION_FAILED') {
      return res.status(502).json({ code: error.code });
    }
    return res.status(500).json({ error: 'Не удалось сохранить Visual Bible' });
  }
});

router.post('/:id/visual-bible/edit', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['instruction', 'expectedEditVersion', 'sourceScriptRevision'].includes(key)) ||
        typeof body.instruction !== 'string' || !body.instruction.trim() || body.instruction.trim().length > 2000 ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 0 ||
        !Number.isSafeInteger(body.sourceScriptRevision) || body.sourceScriptRevision < 1) {
      return res.status(400).json({ error: 'Нужны инструкция до 2 000 символов, expectedEditVersion и sourceScriptRevision.' });
    }
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: 'Проект не найден' });
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const bible = normalizeVisualBible(project);
    if (bible.status !== 'draft' || project.script?.status !== 'confirmed' ||
        bible.editVersion !== body.expectedEditVersion || bible.sourceScriptRevision !== body.sourceScriptRevision ||
        project.script.revision !== body.sourceScriptRevision) {
      return res.status(409).json({ error: 'Bible или сценарий изменились. Перезагрузите данные.' });
    }
    const settings = await Settings.findOne({ userId: req.user._id });
    const rawResponse = await editVisualBible(
      project.title, project.script.content, bible, body.instruction.trim(),
      settings?.prompts?.visualBibleEditPrompt || DEFAULT_VISUAL_BIBLE_EDIT_PROMPT,
      resolveProfile(settings, 'text'),
    );
    let preview;
    try {
      preview = validateVisualBibleContent(
        normalizeEditedVisualBible(rawResponse, bible),
        bible,
        { assignNewIds: false },
      );
    } catch (error) {
      if (error.code === 'INVALID_VISUAL_BIBLE_RESPONSE' || error.status === 400) {
        return res.status(502).json({ code: 'INVALID_VISUAL_BIBLE_RESPONSE', fields: error.fields || ['$'] });
      }
      throw error;
    }
    return res.json({
      success: true,
      preview,
      expectedEditVersion: bible.editVersion,
      sourceScriptRevision: bible.sourceScriptRevision,
    });
  } catch (error) {
    if (error.code === 'VISUAL_BIBLE_EDIT_FAILED') return res.status(502).json({ code: error.code });
    return res.status(500).json({ error: 'Не удалось подготовить preview Visual Bible' });
  }
});

function referencePlanResponse(project, assets = []) {
  const plan = normalizeReferencePlan(project);
  const assetByReference = new Map(assets.map(asset => [asset.referenceId, asset]));
  return {
    success: true,
    scriptStatus: project.script?.status ?? null,
    scriptRevision: project.script?.revision ?? null,
    voiceoverStatus: project.voiceover?.status ?? 'empty',
    referencePlan: {
      ...plan,
      items: plan.items.map(item => ({
        ...(item.toObject?.() ?? item),
        image: assetByReference.has(item.id)
          ? visualReferenceMetadata(assetByReference.get(item.id), item)
          : null,
      })),
    },
  };
}

async function loadReferencePlanResponse(project, userId) {
  const assets = await VisualReference.find({ projectId: project._id, userId });
  return referencePlanResponse(project, assets);
}

async function removeOrphanReferenceAssets(project, userId, retainedIds) {
  const orphans = await VisualReference.find({
    projectId: project._id, userId, referenceId: { $nin: retainedIds },
  }).select('+storageKey');
  if (!orphans.length) return;
  await VisualReference.deleteMany({ _id: { $in: orphans.map(item => item._id) }, projectId: project._id, userId });
  await Promise.all(orphans.map(item => deleteVisualReferenceFile(item.storageKey, project.projectPath, userId)
    .catch(() => console.error('VISUAL_REFERENCE_ORPHAN_DELETE_FAILED'))));
}

router.get('/:id/reference-plan', ensureAuthenticated, async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: 'Проект не найден' });
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    return res.json(await loadReferencePlanResponse(project, req.user._id));
  } catch {
    return res.status(500).json({ error: 'Не удалось загрузить план референсов' });
  }
});

router.post('/:id/reference-plan/analyze', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['instructions', 'items', 'expectedEditVersion', 'sourceScriptRevision'].includes(key)) ||
        typeof body.instructions !== 'string' || body.instructions.length > 4000 ||
        !Array.isArray(body.items) ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 0 ||
        !Number.isSafeInteger(body.sourceScriptRevision) || body.sourceScriptRevision < 1) {
      return res.status(400).json({ error: 'Некорректные параметры анализа' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const plan = normalizeReferencePlan(project);
    if (project.script?.status !== 'confirmed' || project.script.revision !== body.sourceScriptRevision ||
        project.voiceover?.status !== 'confirmed' || project.voiceover.sourceScriptRevision !== body.sourceScriptRevision ||
        plan.editVersion !== body.expectedEditVersion) {
      return res.status(409).json({ error: 'Сначала утвердите актуальный текст для озвучки.' });
    }
    let currentItems;
    try { currentItems = validateReferenceItems(body.items, plan.items); }
    catch { return res.status(400).json({ error: 'Некорректные карточки референсов' }); }
    const settings = await Settings.findOne({ userId: req.user._id });
    const raw = await analyzeScriptReferences(
      project, currentItems, body.instructions.trim(),
      settings?.prompts?.referenceAnalysisPrompt || DEFAULT_REFERENCE_ANALYSIS_PROMPT,
      resolveProfile(settings, 'text'),
    );
    let items;
    try { items = parseReferenceAnalysis(raw, currentItems); }
    catch { return res.status(502).json({ code: 'INVALID_REFERENCE_ANALYSIS' }); }
    const now = new Date();
    const versionFilter = body.expectedEditVersion === 0
      ? { $or: [{ 'referencePlan.editVersion': 0 }, { 'referencePlan.editVersion': { $exists: false } }] }
      : { 'referencePlan.editVersion': body.expectedEditVersion };
    const saved = await Project.findOneAndUpdate({
      ...owner, 'script.status': 'confirmed', 'script.revision': body.sourceScriptRevision,
      'voiceover.status': 'confirmed', 'voiceover.sourceScriptRevision': body.sourceScriptRevision, ...versionFilter,
    }, { $set: {
      referencePlan: {
        status: 'draft', revision: plan.revision || 0, editVersion: body.expectedEditVersion + 1,
        sourceScriptRevision: body.sourceScriptRevision, instructions: body.instructions.trim(), items,
        updatedAt: now, confirmedAt: null,
      }, updatedAt: now,
    } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Сценарий или список референсов изменились. Обновите страницу.' });
    await removeOrphanReferenceAssets(saved, req.user._id, items.map(item => item.id));
    return res.json(await loadReferencePlanResponse(saved, req.user._id));
  } catch (error) {
    if (error.code === 'REFERENCE_ANALYSIS_FAILED') return res.status(502).json({ code: error.code });
    return res.status(500).json({ error: 'Не удалось проанализировать сценарий' });
  }
});

router.put('/:id/reference-plan', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['instructions', 'items', 'expectedEditVersion'].includes(key)) ||
        typeof body.instructions !== 'string' || body.instructions.length > 4000 ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 1) {
      return res.status(400).json({ error: 'Некорректный план референсов' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const plan = normalizeReferencePlan(project);
    if (plan.editVersion !== body.expectedEditVersion || plan.status === 'empty') {
      return res.status(409).json({ error: 'Список референсов изменился. Обновите страницу.' });
    }
    let items;
    try { items = validateReferenceItems(body.items, plan.items); }
    catch { return res.status(400).json({ error: 'Некорректные карточки референсов' }); }
    const saved = await Project.findOneAndUpdate({ ...owner, 'referencePlan.editVersion': body.expectedEditVersion }, {
      $set: {
        'referencePlan.items': items, 'referencePlan.instructions': body.instructions.trim(),
        'referencePlan.status': 'draft', 'referencePlan.confirmedAt': null,
        'referencePlan.updatedAt': new Date(), updatedAt: new Date(),
      }, $inc: { 'referencePlan.editVersion': 1 },
    }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Список референсов изменился. Обновите страницу.' });
    await removeOrphanReferenceAssets(saved, req.user._id, items.map(item => item.id));
    return res.json(await loadReferencePlanResponse(saved, req.user._id));
  } catch {
    return res.status(500).json({ error: 'Не удалось сохранить план референсов' });
  }
});

router.post('/:id/reference-plan/confirm', ensureAuthenticated, async (req, res) => {
  try {
    const { expectedEditVersion, sourceScriptRevision } = req.body || {};
    if (!Number.isSafeInteger(expectedEditVersion) || expectedEditVersion < 1 ||
        !Number.isSafeInteger(sourceScriptRevision) || sourceScriptRevision < 1) {
      return res.status(400).json({ error: 'Некорректные версии плана' });
    }
    const saved = await Project.findOneAndUpdate({
      _id: req.params.id, userId: req.user._id, 'script.status': 'confirmed',
      'script.revision': sourceScriptRevision, 'referencePlan.status': 'draft',
      'voiceover.status': 'confirmed', 'voiceover.sourceScriptRevision': sourceScriptRevision,
      'referencePlan.sourceScriptRevision': sourceScriptRevision,
      'referencePlan.editVersion': expectedEditVersion,
      'referencePlan.items': { $elemMatch: { selected: true } },
    }, { $set: {
      'referencePlan.status': 'confirmed', 'referencePlan.confirmedAt': new Date(),
      'referencePlan.updatedAt': new Date(), updatedAt: new Date(),
    }, $inc: { 'referencePlan.revision': 1, 'referencePlan.editVersion': 1 } },
    { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'План или сценарий изменились либо не выбран ни один референс.' });
    return res.json(await loadReferencePlanResponse(saved, req.user._id));
  } catch {
    return res.status(500).json({ error: 'Не удалось утвердить план референсов' });
  }
});

router.post('/:id/reference-plan/:referenceId/detail-prompt', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['instruction', 'expectedEditVersion', 'sourceScriptRevision'].includes(key)) ||
        typeof body.instruction !== 'string' || body.instruction.length > 2000 ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 1 ||
        !Number.isSafeInteger(body.sourceScriptRevision) || body.sourceScriptRevision < 1) {
      return res.status(400).json({ error: 'Некорректные параметры детализации' });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const plan = normalizeReferencePlan(project);
    const reference = plan.items.find(item => item.id === req.params.referenceId);
    if (!reference) return res.status(404).json({ error: 'Референс не найден' });
    if (project.script?.status !== 'confirmed' || project.script.revision !== body.sourceScriptRevision ||
        project.voiceover?.status !== 'confirmed' || project.voiceover.sourceScriptRevision !== body.sourceScriptRevision ||
        plan.sourceScriptRevision !== body.sourceScriptRevision || plan.editVersion !== body.expectedEditVersion ||
        !['draft', 'confirmed'].includes(plan.status)) {
      return res.status(409).json({ error: 'Сценарий или план референсов изменились. Обновите страницу.' });
    }
    const settings = await Settings.findOne({ userId: req.user._id });
    const prompt = await detailReferencePrompt(
      project, reference, body.instruction.trim(),
      settings?.prompts?.referenceDetailPrompt || DEFAULT_REFERENCE_DETAIL_PROMPT,
      resolveProfile(settings, 'text'),
    );
    const saved = await Project.findOneAndUpdate({
      _id: project._id, userId: req.user._id, 'script.status': 'confirmed',
      'script.revision': body.sourceScriptRevision, 'voiceover.status': 'confirmed',
      'voiceover.sourceScriptRevision': body.sourceScriptRevision,
      'referencePlan.editVersion': body.expectedEditVersion,
      'referencePlan.items': { $elemMatch: { id: reference.id, version: reference.version } },
    }, { $set: {
      'referencePlan.items.$[item].prompt': prompt,
      'referencePlan.status': 'draft', 'referencePlan.confirmedAt': null,
      'referencePlan.updatedAt': new Date(), updatedAt: new Date(),
    }, $inc: {
      'referencePlan.items.$[item].version': 1,
      'referencePlan.editVersion': 1,
    } }, { new: true, runValidators: true, arrayFilters: [{ 'item.id': reference.id }] });
    if (!saved) return res.status(409).json({ error: 'План референсов изменился. Повторите детализацию.' });
    return res.json(await loadReferencePlanResponse(saved, req.user._id));
  } catch (error) {
    if (error.code === 'REFERENCE_DETAIL_FAILED') return res.status(502).json({ code: error.code });
    return res.status(500).json({ error: 'Не удалось детализировать prompt' });
  }
});

async function storyboardResponse(project, userId) {
  const stored = normalizeStoryboard(project);
  const selected = (project.referencePlan?.items || []).filter(item => item.selected);
  const assets = await VisualReference.find({
    projectId: project._id, userId, referenceId: { $in: selected.map(item => item.id) },
  });
  const ready = new Set(assets.filter(asset => asset.status === 'ready').map(asset => asset.referenceId));
  const generatedImages = await StoryboardImage.find({
    projectId: project._id, userId, frameId: { $in: stored.frames.map(frame => frame.id) },
  }).select('+storageKey');
  const imageByFrame = new Map(generatedImages.map(image => [image.frameId, image]));
  const frames = stored.frames.map(frame => {
    const image = imageByFrame.get(frame.id);
    const current = storyboardImageMatchesFrame(image, frame);
    return {
      ...frame,
      image: current ? {
        id: image._id.toString(), status: image.status, hasImage: image.status === 'ready' && Boolean(image.storageKey),
        mimeType: image.mimeType, byteSize: image.byteSize, profileId: image.profileId,
        model: image.model, errorCode: image.errorCode, generatedAt: image.generatedAt,
        updatedAt: image.updatedAt,
      } : { status: 'pending', hasImage: false, stale: Boolean(image) },
    };
  });
  return {
    success: true,
    scriptStatus: project.script?.status ?? null,
    scriptRevision: project.script?.revision ?? null,
    referencePlanStatus: project.referencePlan?.status ?? 'empty',
    referencePlanRevision: project.referencePlan?.revision ?? 0,
    voiceoverStatus: project.voiceover?.status ?? 'empty',
    voiceoverRevision: project.voiceover?.revision ?? 0,
    voiceoverBlocks: (project.voiceover?.blocks || []).map(block => ({
      id: block.id, order: block.order, sourceTitle: block.sourceTitle, adaptedText: block.adaptedText,
    })),
    references: selected.map(item => ({
      id: item.id, name: item.name, type: item.type, imageReady: ready.has(item.id),
    })),
    storyboard: {
      ...stored,
      frames,
      status: stored.status === 'empty' || storyboardIsCurrent(project, stored) ? stored.status : 'stale',
    },
  };
}

function selectedStoryboardReferences(project) {
  return (project.referencePlan?.items || []).filter(item => item.selected);
}

router.get('/:id/storyboard', ensureAuthenticated, async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: 'Проект не найден' });
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    return res.json(await storyboardResponse(project, req.user._id));
  } catch {
    return res.status(500).json({ error: 'Не удалось загрузить раскадровку' });
  }
});

router.post('/:id/storyboard/generate', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['instructions', 'frames', 'expectedEditVersion', 'sourceScriptRevision', 'sourceReferencePlanRevision', 'sourceVoiceoverRevision'].includes(key)) ||
        typeof body.instructions !== 'string' || body.instructions.length > 4000 || !Array.isArray(body.frames) ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 0 ||
        !Number.isSafeInteger(body.sourceScriptRevision) || body.sourceScriptRevision < 1 ||
        !Number.isSafeInteger(body.sourceReferencePlanRevision) || body.sourceReferencePlanRevision < 1 ||
        !Number.isSafeInteger(body.sourceVoiceoverRevision) || body.sourceVoiceoverRevision < 1) {
      return res.status(400).json({ error: 'Некорректные параметры раскадровки' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    if (project.script?.status !== 'confirmed' || project.script.revision !== body.sourceScriptRevision ||
        project.voiceover?.status !== 'confirmed' || project.voiceover.revision !== body.sourceVoiceoverRevision ||
        project.referencePlan?.status !== 'confirmed' || project.referencePlan.revision !== body.sourceReferencePlanRevision ||
        storyboard.editVersion !== body.expectedEditVersion) {
      return res.status(409).json({ error: 'Сценарий, референсы или раскадровка изменились. Обновите страницу.' });
    }
    const references = selectedStoryboardReferences(project);
    if (!references.length) return res.status(409).json({ error: 'Сначала утвердите хотя бы один референс.' });
    const allowedReferenceIds = new Set(references.map(item => item.id));
    const voiceoverBlocks = (project.voiceover.blocks || []).map(block => ({
      id: block.id, order: block.order, adaptedText: block.adaptedText,
    }));
    const sanitizedInput = body.frames.map(frame => ({
      ...frame,
      referenceIds: Array.isArray(frame?.referenceIds)
        ? frame.referenceIds.filter(id => allowedReferenceIds.has(id)) : [],
    }));
    let currentFrames;
    try {
      currentFrames = sanitizedInput.length
        ? validateStoryboardFrames(sanitizedInput, storyboard.frames, allowedReferenceIds, voiceoverBlocks) : [];
    } catch {
      return res.status(400).json({ error: 'Некорректные карточки кадров' });
    }
    const settings = await Settings.findOne({ userId: req.user._id });
    const raw = await generateStoryboard(
      project, references, currentFrames, body.instructions.trim(),
      settings?.prompts?.storyboardPrompt || DEFAULT_STORYBOARD_PROMPT,
      resolveProfile(settings, 'text'),
    );
    let frames;
    try { frames = parseGeneratedStoryboard(raw, currentFrames, allowedReferenceIds, voiceoverBlocks); }
    catch (error) { return res.status(502).json({ code: error.code || 'INVALID_STORYBOARD_RESPONSE' }); }
    const now = new Date();
    const versionFilter = body.expectedEditVersion === 0
      ? { $or: [{ 'storyboard.editVersion': 0 }, { 'storyboard.editVersion': { $exists: false } }] }
      : { 'storyboard.editVersion': body.expectedEditVersion };
    const saved = await Project.findOneAndUpdate({
      ...owner, 'script.status': 'confirmed', 'script.revision': body.sourceScriptRevision,
      'voiceover.status': 'confirmed', 'voiceover.revision': body.sourceVoiceoverRevision,
      'referencePlan.status': 'confirmed', 'referencePlan.revision': body.sourceReferencePlanRevision,
      ...versionFilter,
    }, { $set: {
      storyboard: {
        status: 'draft', revision: storyboard.revision || 0,
        editVersion: body.expectedEditVersion + 1,
        sourceScriptRevision: body.sourceScriptRevision,
        sourceReferencePlanRevision: body.sourceReferencePlanRevision,
        sourceVoiceoverRevision: body.sourceVoiceoverRevision,
        instructions: body.instructions.trim(), frames, updatedAt: now, confirmedAt: null,
      }, updatedAt: now,
    } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Сценарий, референсы или раскадровка изменились. Обновите страницу.' });
    return res.json(await storyboardResponse(saved, req.user._id));
  } catch (error) {
    if (error.code === 'STORYBOARD_INPUT_TOO_LONG') return res.status(400).json({ code: error.code });
    if (error.code === 'STORYBOARD_GENERATION_FAILED') return res.status(502).json({ code: error.code });
    return res.status(500).json({ error: 'Не удалось создать раскадровку' });
  }
});

router.post('/:id/storyboard/detail-prompts/reset', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['expectedEditVersion', 'sourceScriptRevision', 'sourceReferencePlanRevision', 'sourceVoiceoverRevision'].includes(key)) ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 1 ||
        !Number.isSafeInteger(body.sourceScriptRevision) || body.sourceScriptRevision < 1 ||
        !Number.isSafeInteger(body.sourceReferencePlanRevision) || body.sourceReferencePlanRevision < 1 ||
        !Number.isSafeInteger(body.sourceVoiceoverRevision) || body.sourceVoiceoverRevision < 1) {
      return res.status(400).json({ error: 'Некорректные параметры сброса детализации' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    if (!storyboard.frames.length || !['draft', 'confirmed'].includes(storyboard.status) ||
        !storyboardIsCurrent(project, storyboard) || storyboard.editVersion !== body.expectedEditVersion ||
        storyboard.sourceScriptRevision !== body.sourceScriptRevision ||
        storyboard.sourceReferencePlanRevision !== body.sourceReferencePlanRevision ||
        storyboard.sourceVoiceoverRevision !== body.sourceVoiceoverRevision) {
      return res.status(409).json({ error: 'Раскадровка или исходные данные изменились. Обновите страницу.' });
    }
    const saved = await Project.findOneAndUpdate({
      ...owner, 'storyboard.editVersion': body.expectedEditVersion,
      'storyboard.sourceScriptRevision': body.sourceScriptRevision,
      'storyboard.sourceReferencePlanRevision': body.sourceReferencePlanRevision,
      'storyboard.sourceVoiceoverRevision': body.sourceVoiceoverRevision,
    }, { $set: {
      'storyboard.frames.$[].promptDetailStatus': 'pending',
      'storyboard.frames.$[].promptDetailedAt': null,
      'storyboard.frames.$[].promptDetailErrorCode': '',
      'storyboard.updatedAt': new Date(), updatedAt: new Date(),
    }, $inc: { 'storyboard.editVersion': 1 } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Раскадровка изменилась. Обновите страницу.' });
    return res.json(await storyboardResponse(saved, req.user._id));
  } catch {
    return res.status(500).json({ error: 'Не удалось начать детализацию заново' });
  }
});

router.post('/:id/storyboard/frames/:frameId/detail-prompt', ensureAuthenticated, async (req, res) => {
  let failureContext = null;
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['instruction', 'expectedEditVersion', 'sourceScriptRevision', 'sourceReferencePlanRevision', 'sourceVoiceoverRevision'].includes(key)) ||
        typeof body.instruction !== 'string' || body.instruction.length > 2000 ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 1 ||
        !Number.isSafeInteger(body.sourceScriptRevision) || body.sourceScriptRevision < 1 ||
        !Number.isSafeInteger(body.sourceReferencePlanRevision) || body.sourceReferencePlanRevision < 1 ||
        !Number.isSafeInteger(body.sourceVoiceoverRevision) || body.sourceVoiceoverRevision < 1) {
      return res.status(400).json({ error: 'Некорректные параметры детализации' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    const frame = storyboard.frames.find(item => item.id === req.params.frameId);
    if (!frame) return res.status(404).json({ error: 'Кадр не найден' });
    if (!['draft', 'confirmed'].includes(storyboard.status) || !storyboardIsCurrent(project, storyboard) ||
        storyboard.editVersion !== body.expectedEditVersion ||
        storyboard.sourceScriptRevision !== body.sourceScriptRevision ||
        storyboard.sourceReferencePlanRevision !== body.sourceReferencePlanRevision ||
        storyboard.sourceVoiceoverRevision !== body.sourceVoiceoverRevision) {
      return res.status(409).json({ error: 'Раскадровка или исходные данные изменились. Обновите страницу.' });
    }
    failureContext = { owner, frameId: frame.id, editVersion: body.expectedEditVersion };
    const references = selectedStoryboardReferences(project);
    const settings = await Settings.findOne({ userId: req.user._id });
    const prompt = await detailStoryboardFramePrompt(
      project, frame, references, body.instruction.trim(),
      settings?.prompts?.storyboardDetailPrompt || DEFAULT_STORYBOARD_DETAIL_PROMPT,
      resolveProfile(settings, 'text'),
    );
    const saved = await Project.findOneAndUpdate({
      ...owner, 'storyboard.editVersion': body.expectedEditVersion,
      'storyboard.sourceScriptRevision': body.sourceScriptRevision,
      'storyboard.sourceReferencePlanRevision': body.sourceReferencePlanRevision,
      'storyboard.sourceVoiceoverRevision': body.sourceVoiceoverRevision,
      'storyboard.frames.id': frame.id,
      'script.status': 'confirmed', 'script.revision': body.sourceScriptRevision,
      'voiceover.status': 'confirmed', 'voiceover.revision': body.sourceVoiceoverRevision,
      'referencePlan.status': 'confirmed', 'referencePlan.revision': body.sourceReferencePlanRevision,
    }, { $set: {
      'storyboard.frames.$[frame].prompt': prompt,
      'storyboard.frames.$[frame].promptDetailStatus': 'ready',
      'storyboard.frames.$[frame].promptDetailedAt': new Date(),
      'storyboard.frames.$[frame].promptDetailErrorCode': '',
      'storyboard.status': 'draft', 'storyboard.confirmedAt': null,
      'storyboard.updatedAt': new Date(), updatedAt: new Date(),
    }, $inc: { 'storyboard.editVersion': 1 } }, {
      new: true, runValidators: true, arrayFilters: [{ 'frame.id': frame.id }],
    });
    if (!saved) return res.status(409).json({ error: 'Кадр изменился во время детализации. Повторите запрос.' });
    return res.json(await storyboardResponse(saved, req.user._id));
  } catch (error) {
    if (['STORYBOARD_DETAIL_FAILED', 'STORYBOARD_DETAIL_RATE_LIMIT'].includes(error.code)) {
      if (failureContext) {
        await Project.findOneAndUpdate({
          ...failureContext.owner, 'storyboard.editVersion': failureContext.editVersion,
          'storyboard.frames.id': failureContext.frameId,
        }, { $set: {
          'storyboard.frames.$[frame].promptDetailStatus': 'error',
          'storyboard.frames.$[frame].promptDetailErrorCode': error.code,
          'storyboard.frames.$[frame].promptDetailedAt': null,
        } }, { arrayFilters: [{ 'frame.id': failureContext.frameId }] }).catch(() => {});
      }
      const limited = error.code === 'STORYBOARD_DETAIL_RATE_LIMIT';
      return res.status(limited ? 429 : 502).json({
        error: limited
          ? 'Достигнут временный лимит Gemini. Детализация продолжится после паузы.'
          : 'ИИ не смог детализировать prompt кадра',
        code: error.code,
        ...(limited ? { retryAfterMs: error.retryAfterMs || 60_000 } : {}),
      });
    }
    return res.status(500).json({ error: 'Не удалось детализировать prompt кадра' });
  }
});

router.put('/:id/storyboard', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['instructions', 'frames', 'expectedEditVersion'].includes(key)) ||
        typeof body.instructions !== 'string' || body.instructions.length > 4000 || !Array.isArray(body.frames) ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 1) {
      return res.status(400).json({ error: 'Некорректная раскадровка' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    if (storyboard.status === 'empty' || storyboard.editVersion !== body.expectedEditVersion ||
        !storyboardIsCurrent(project, storyboard)) {
      return res.status(409).json({ error: 'Сценарий, референсы или раскадровка изменились. Обновите страницу.' });
    }
    const allowedReferenceIds = new Set(selectedStoryboardReferences(project).map(item => item.id));
    const voiceoverBlocks = (project.voiceover?.blocks || []).map(block => ({ id: block.id, order: block.order, adaptedText: block.adaptedText }));
    let frames;
    try { frames = validateStoryboardFrames(body.frames, storyboard.frames, allowedReferenceIds, voiceoverBlocks); }
    catch { return res.status(400).json({ error: 'Некорректные карточки кадров' }); }
    const saved = await Project.findOneAndUpdate({
      ...owner, 'storyboard.editVersion': body.expectedEditVersion,
      'script.status': 'confirmed', 'script.revision': storyboard.sourceScriptRevision,
      'voiceover.status': 'confirmed', 'voiceover.revision': storyboard.sourceVoiceoverRevision,
      'referencePlan.status': 'confirmed', 'referencePlan.revision': storyboard.sourceReferencePlanRevision,
    }, { $set: {
      'storyboard.frames': frames, 'storyboard.instructions': body.instructions.trim(),
      'storyboard.status': 'draft', 'storyboard.confirmedAt': null,
      'storyboard.updatedAt': new Date(), updatedAt: new Date(),
    }, $inc: { 'storyboard.editVersion': 1 } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Раскадровка изменилась. Обновите страницу.' });
    return res.json(await storyboardResponse(saved, req.user._id));
  } catch {
    return res.status(500).json({ error: 'Не удалось сохранить раскадровку' });
  }
});

router.patch('/:id/storyboard/frames/:frameId', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['frame', 'expectedEditVersion', 'sourceStoryboardRevision'].includes(key)) ||
        !body.frame || typeof body.frame !== 'object' || Array.isArray(body.frame) ||
        !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 1 ||
        !Number.isSafeInteger(body.sourceStoryboardRevision) || body.sourceStoryboardRevision < 1) {
      return res.status(400).json({ error: 'Некорректные данные кадра' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    const frameIndex = storyboard.frames.findIndex(frame => frame.id === req.params.frameId);
    if (frameIndex < 0) return res.status(404).json({ error: 'Кадр не найден' });
    if (storyboard.status !== 'confirmed' || storyboard.revision !== body.sourceStoryboardRevision ||
        storyboard.editVersion !== body.expectedEditVersion || !storyboardIsCurrent(project, storyboard)) {
      return res.status(409).json({ error: 'Раскадровка изменилась. Обновите страницу.' });
    }
    const allowedReferenceIds = new Set(selectedStoryboardReferences(project).map(item => item.id));
    const voiceoverBlocks = (project.voiceover?.blocks || []).map(block => ({
      id: block.id, order: block.order, adaptedText: block.adaptedText,
    }));
    const candidateFrames = storyboard.frames.map((frame, index) => storyboardEditableFrame(
      index === frameIndex ? { ...body.frame, id: frame.id } : frame,
    ));
    let frames;
    try {
      frames = validateStoryboardFrames(candidateFrames, storyboard.frames, allowedReferenceIds, voiceoverBlocks);
    } catch {
      return res.status(400).json({ error: 'Кадр нарушает структуру или точный текст озвучки' });
    }
    const nextFrame = frames[frameIndex];
    const saved = await Project.findOneAndUpdate({
      ...owner, 'storyboard.status': 'confirmed', 'storyboard.revision': body.sourceStoryboardRevision,
      'storyboard.editVersion': body.expectedEditVersion,
      'storyboard.frames': { $elemMatch: { id: req.params.frameId } },
    }, { $set: {
      'storyboard.frames.$[frame]': nextFrame,
      'storyboard.updatedAt': new Date(), updatedAt: new Date(),
    }, $inc: {
      'storyboard.revision': 1, 'storyboard.editVersion': 1,
    } }, {
      new: true, runValidators: true, arrayFilters: [{ 'frame.id': req.params.frameId }],
    });
    if (!saved) return res.status(409).json({ error: 'Раскадровка изменилась. Обновите страницу.' });
    return res.json(await storyboardResponse(saved, req.user._id));
  } catch {
    return res.status(500).json({ error: 'Не удалось сохранить кадр' });
  }
});

router.post('/:id/storyboard/confirm', ensureAuthenticated, async (req, res) => {
  try {
    const { expectedEditVersion, sourceScriptRevision, sourceReferencePlanRevision, sourceVoiceoverRevision } = req.body || {};
    if (!Number.isSafeInteger(expectedEditVersion) || expectedEditVersion < 1 ||
        !Number.isSafeInteger(sourceScriptRevision) || sourceScriptRevision < 1 ||
        !Number.isSafeInteger(sourceReferencePlanRevision) || sourceReferencePlanRevision < 1 ||
        !Number.isSafeInteger(sourceVoiceoverRevision) || sourceVoiceoverRevision < 1) {
      return res.status(400).json({ error: 'Некорректные версии раскадровки' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    if (storyboard.status !== 'draft' || storyboard.editVersion !== expectedEditVersion ||
        storyboard.sourceScriptRevision !== sourceScriptRevision ||
        storyboard.sourceReferencePlanRevision !== sourceReferencePlanRevision ||
        storyboard.sourceVoiceoverRevision !== sourceVoiceoverRevision ||
        !storyboard.frames.length || storyboard.frames.some(frame => !frame.scriptText || !frame.visualDescription || !frame.prompt) ||
        !storyboardIsCurrent(project, storyboard)) {
      return res.status(409).json({ error: 'Раскадровка, сценарий или референсы изменились.' });
    }
    const saved = await Project.findOneAndUpdate({
      ...owner, 'storyboard.status': 'draft', 'storyboard.editVersion': expectedEditVersion,
      'storyboard.sourceScriptRevision': sourceScriptRevision,
      'storyboard.sourceReferencePlanRevision': sourceReferencePlanRevision,
      'storyboard.sourceVoiceoverRevision': sourceVoiceoverRevision,
      'script.status': 'confirmed', 'script.revision': sourceScriptRevision,
      'voiceover.status': 'confirmed', 'voiceover.revision': sourceVoiceoverRevision,
      'referencePlan.status': 'confirmed', 'referencePlan.revision': sourceReferencePlanRevision,
    }, { $set: {
      'storyboard.status': 'confirmed', 'storyboard.confirmedAt': new Date(),
      'storyboard.updatedAt': new Date(), updatedAt: new Date(),
    }, $inc: { 'storyboard.revision': 1, 'storyboard.editVersion': 1 } },
    { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Раскадровка изменилась. Обновите страницу.' });
    return res.json(await storyboardResponse(saved, req.user._id));
  } catch {
    return res.status(500).json({ error: 'Не удалось утвердить раскадровку' });
  }
});

router.post('/:id/storyboard/images/reset', ensureAuthenticated, async (req, res) => {
  try {
    const { sourceStoryboardRevision } = req.body || {};
    if (Object.keys(req.body || {}).some(key => key !== 'sourceStoryboardRevision') ||
        !Number.isSafeInteger(sourceStoryboardRevision) || sourceStoryboardRevision < 1) {
      return res.status(400).json({ error: 'Некорректная версия раскадровки' });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    if (storyboard.status !== 'confirmed' || storyboard.revision !== sourceStoryboardRevision ||
        !storyboardIsCurrent(project, storyboard)) {
      return res.status(409).json({ error: 'Раскадровка изменилась. Обновите страницу.' });
    }
    if (storyboard.frames.length) {
      await StoryboardImage.bulkWrite(storyboard.frames.map(frame => ({
        updateOne: {
          filter: { projectId: project._id, userId: req.user._id, frameId: frame.id },
          update: {
            $set: {
              sourceStoryboardRevision, sourcePrompt: frame.prompt,
              sourceReferenceIds: frame.referenceIds, status: 'pending', errorCode: '',
            },
            $setOnInsert: { projectId: project._id, userId: req.user._id, frameId: frame.id },
          },
          upsert: true,
        },
      })));
    }
    return res.json(await storyboardResponse(project, req.user._id));
  } catch {
    return res.status(500).json({ error: 'Не удалось начать генерацию изображений заново' });
  }
});

router.post('/:id/storyboard/images/reconcile', ensureAuthenticated, async (req, res) => {
  try {
    const { sourceStoryboardRevision } = req.body || {};
    if (Object.keys(req.body || {}).some(key => key !== 'sourceStoryboardRevision') ||
        !Number.isSafeInteger(sourceStoryboardRevision) || sourceStoryboardRevision < 1) {
      return res.status(400).json({ error: 'Некорректная версия раскадровки' });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    if (storyboard.status !== 'confirmed' || storyboard.revision !== sourceStoryboardRevision ||
        !storyboardIsCurrent(project, storyboard)) {
      return res.status(409).json({ error: 'Раскадровка изменилась. Обновите страницу.' });
    }
    const images = await StoryboardImage.find({
      projectId: project._id, userId: req.user._id,
      frameId: { $in: storyboard.frames.map(frame => frame.id) },
    }).select('+storageKey');
    const imageByFrame = new Map(images.map(image => [image.frameId, image]));
    const matching = storyboard.frames
      .map(frame => ({ frame, image: imageByFrame.get(frame.id) }))
      .filter(({ frame, image }) => image?.status === 'ready' && image?.storageKey &&
        storyboardImageMatchesFrame(image, frame));
    const reattach = matching.filter(({ image }) => image.sourceStoryboardRevision !== storyboard.revision);
    if (reattach.length) {
      await StoryboardImage.bulkWrite(reattach.map(({ image }) => ({
        updateOne: {
          filter: { _id: image._id, projectId: project._id, userId: req.user._id },
          update: { $set: { sourceStoryboardRevision: storyboard.revision } },
        },
      })));
    }
    const response = await storyboardResponse(project, req.user._id);
    return res.json({
      ...response,
      reconcileSummary: {
        reattached: reattach.length,
        current: matching.length,
        stale: images.length - matching.length,
        missing: storyboard.frames.length - images.length,
      },
    });
  } catch {
    return res.status(500).json({ error: 'Не удалось проверить привязки изображений' });
  }
});

function storyboardImageIsCurrent(image, storyboard, frame) {
  return image?.status === 'ready' && Boolean(image.storageKey) &&
    storyboardImageMatchesFrame(image, frame);
}

async function saveFlowStoryboardImage({ project, userId, storyboard, frame, buffer }) {
  detectImageFormat(buffer);
  let storedFile;
  let fileCommitted = false;
  try {
    storedFile = await saveStoryboardImageFile({
      projectId: project._id.toString(), frameId: frame.id, projectPath: project.projectPath,
      project, userId, fileBaseName: storyboardFrameFileBase(project, frame), buffer,
    });
    const stillCurrent = await Project.exists({
      _id: project._id, userId, 'storyboard.status': 'confirmed',
      'storyboard.revision': storyboard.revision,
      'storyboard.frames': { $elemMatch: { id: frame.id, prompt: frame.prompt, referenceIds: frame.referenceIds } },
    });
    if (!stillCurrent) {
      await rollbackStoryboardImageFile(storedFile);
      storedFile = null;
      const error = new Error('STORYBOARD_CHANGED'); error.code = 'STORYBOARD_CHANGED'; throw error;
    }
    const previous = await StoryboardImage.findOne({
      projectId: project._id, userId, frameId: frame.id,
    }).select('+storageKey');
    await StoryboardImage.findOneAndUpdate(
      { projectId: project._id, userId, frameId: frame.id },
      {
        $set: {
          sourceStoryboardRevision: storyboard.revision, sourcePrompt: frame.prompt,
          sourceReferenceIds: frame.referenceIds, status: 'ready', storageKey: storedFile.storageKey,
          mimeType: storedFile.mimeType, byteSize: storedFile.byteSize, profileId: 'google-flow',
          model: 'google-flow', errorCode: '', generatedAt: new Date(),
        },
        $setOnInsert: { projectId: project._id, userId, frameId: frame.id },
      },
      { upsert: true, runValidators: true },
    );
    await commitStoryboardImageFile(storedFile);
    fileCommitted = true;
    if (previous?.storageKey && previous.storageKey !== storedFile.storageKey) {
      deleteStoryboardImageFile(previous.storageKey, project.projectPath, userId).catch(() => console.error('STORYBOARD_IMAGE_OLD_FILE_DELETE_FAILED'));
    }
    return storedFile;
  } catch (error) {
    if (storedFile?.storageKey && !fileCommitted) await rollbackStoryboardImageFile(storedFile).catch(() => {});
    throw error;
  }
}

router.get('/:id/storyboard/flow/export', ensureAuthenticated, async (req, res) => {
  try {
    const sourceStoryboardRevision = Number(req.query.sourceStoryboardRevision);
    const requestedFrameId = typeof req.query.frameId === 'string' ? req.query.frameId : '';
    if (!Number.isSafeInteger(sourceStoryboardRevision) || sourceStoryboardRevision < 1) {
      return res.status(400).json({ error: 'Некорректная версия раскадровки' });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    if (storyboard.status !== 'confirmed' || storyboard.revision !== sourceStoryboardRevision ||
        !storyboardIsCurrent(project, storyboard)) {
      return res.status(409).json({ error: 'Раскадровка изменилась. Обновите страницу.' });
    }
    const storedImages = await StoryboardImage.find({
      projectId: project._id, userId: req.user._id,
      frameId: { $in: storyboard.frames.map(frame => frame.id) },
    }).select('+storageKey');
    const imageByFrame = new Map(storedImages.map(image => [image.frameId, image]));
    const frames = requestedFrameId
      ? storyboard.frames.filter(frame => frame.id === requestedFrameId)
      : storyboard.frames.filter(frame => !storyboardImageIsCurrent(imageByFrame.get(frame.id), storyboard, frame));
    if (!frames.length) {
      return res.status(requestedFrameId ? 404 : 409).json({
        error: requestedFrameId ? 'Кадр не найден' : 'Все изображения кадров уже готовы',
      });
    }

    const neededReferenceIds = [...new Set(frames.flatMap(frame => frame.referenceIds))];
    const selectedItems = (project.referencePlan?.items || []).filter(item =>
      item.selected && neededReferenceIds.includes(item.id));
    const referenceAssets = await VisualReference.find({
      projectId: project._id, userId: req.user._id,
      referenceId: { $in: neededReferenceIds }, status: 'ready',
    }).select('+storageKey');
    const assetByReference = new Map(referenceAssets.map(asset => [asset.referenceId, asset]));
    const references = (await Promise.all(selectedItems.map(async item => {
      const asset = assetByReference.get(item.id);
      if (!asset || asset.sourceReferenceVersion !== item.version || !asset.storageKey) return null;
      try {
        return {
          id: item.id, name: item.name, type: item.type, mimeType: asset.mimeType,
          fileName: flowReferenceFileName(item, asset.mimeType),
          buffer: await readVisualReferenceFile(asset.storageKey, project.projectPath, req.user._id),
        };
      } catch { return null; }
    }))).filter(Boolean);

    const packageFrames = frames.map(frame => ({
      ...(frame.toObject?.() || frame),
      fileBaseName: storyboardFrameFileBase(project, frame),
    }));
    const manifest = buildFlowManifest({ project, storyboard, frames: packageFrames, references });
    const archive = new JSZip();
    archive.file('manifest.json', JSON.stringify(manifest, null, 2));
    archive.file('prompts.txt', flowPromptsText(packageFrames));
    archive.file('README.txt', [
      'Google Flow: сгенерируйте изображения по prompts и референсам.',
      'Сохраняйте frameId в имени каждого результата.',
      'Рекомендуемое имя указано в manifest.json и prompts.txt.',
      'После генерации поместите доступные изображения в ZIP и импортируйте его в WebApp.',
      'Архив может содержать только часть результатов — остальные кадры останутся в ожидании.',
    ].join('\n'));
    packageFrames.forEach(frame => archive.file(`prompts/${flowFrameBaseName(frame)}.txt`, frame.prompt));
    references.forEach(reference => archive.file(reference.fileName, reference.buffer));
    const buffer = await archive.generateAsync({
      type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 1 },
    });
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="flow-storyboard-r${storyboard.revision}.zip"`);
    res.set('Cache-Control', 'private, no-store');
    return res.send(buffer);
  } catch (error) {
    console.error('FLOW_EXPORT_FAILED', error?.code || error?.message);
    return res.status(500).json({ error: 'Не удалось подготовить пакет для Google Flow' });
  }
});

router.post('/:id/storyboard/flow/import', ensureAuthenticated, parseFlowArchiveUpload, async (req, res) => {
  try {
    const sourceStoryboardRevision = Number(req.body?.sourceStoryboardRevision);
    if (!Number.isSafeInteger(sourceStoryboardRevision) || sourceStoryboardRevision < 1 || !req.file?.buffer) {
      return res.status(400).json({ error: 'Нужны ZIP-архив и версия раскадровки' });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    if (storyboard.status !== 'confirmed' || storyboard.revision !== sourceStoryboardRevision ||
        !storyboardIsCurrent(project, storyboard)) {
      return res.status(409).json({ error: 'Раскадровка изменилась. Создайте новый пакет Flow.' });
    }
    let archive;
    try { archive = await JSZip.loadAsync(req.file.buffer, { checkCRC32: true }); }
    catch { return res.status(400).json({ error: 'Не удалось прочитать ZIP-архив' }); }
    const entries = Object.values(archive.files);
    if (entries.length > 500) return res.status(400).json({ error: 'В архиве слишком много файлов' });
    if (entries.some(entry => entry.unsafeOriginalName?.includes('..') || entry.name.includes('\\') || entry.name.startsWith('/'))) {
      return res.status(400).json({ error: 'Архив содержит небезопасные пути' });
    }
    const importWarnings = [];
    const manifestEntry = archive.file('manifest.json');
    if (manifestEntry) {
      if (manifestEntry._data?.uncompressedSize > 2 * 1024 * 1024) {
        importWarnings.push('Большой manifest.json пропущен; изображения сопоставлены по frameId в именах файлов.');
      } else {
        try {
          const manifestText = await manifestEntry.async('string');
          if (manifestText.length > 2 * 1024 * 1024) {
            importWarnings.push('Большой manifest.json пропущен; изображения сопоставлены по frameId в именах файлов.');
          } else {
            const manifest = JSON.parse(manifestText);
            if (manifest.projectId !== project._id.toString() || manifest.storyboardRevision !== storyboard.revision) {
              return res.status(409).json({ error: 'Архив относится к другой версии проекта' });
            }
          }
        } catch (error) {
          if (error instanceof SyntaxError) {
            importWarnings.push('Изменённый manifest.json пропущен; изображения сопоставлены по frameId.');
          } else {
            throw error;
          }
        }
      }
    }
    const frameById = new Map(storyboard.frames.map(frame => [frame.id, frame]));
    const candidates = entries.filter(entry => !entry.dir && frameIdFromFlowImagePath(entry.name));
    if (!candidates.length) return res.status(400).json({ error: 'В архиве не найдены изображения с frameId в имени' });
    const existingImages = await StoryboardImage.find({
      projectId: project._id, userId: req.user._id,
      frameId: { $in: storyboard.frames.map(frame => frame.id) },
    }).select('+storageKey');
    const existingByFrame = new Map(existingImages.map(image => [image.frameId, image]));
    const handled = new Set();
    const summary = {
      imported: 0, replaced: 0, unknown: 0, duplicates: 0, errors: 0,
      totalFiles: candidates.length, warnings: importWarnings,
    };
    for (const entry of candidates) {
      const frameId = frameIdFromFlowImagePath(entry.name);
      const frame = frameById.get(frameId);
      if (!frame) { summary.unknown += 1; continue; }
      if (handled.has(frameId)) { summary.duplicates += 1; continue; }
      handled.add(frameId);
      const replacing = storyboardImageIsCurrent(existingByFrame.get(frameId), storyboard, frame);
      try {
        if (entry._data?.uncompressedSize > 15 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
        const buffer = await entry.async('nodebuffer');
        await saveFlowStoryboardImage({ project, userId: req.user._id, storyboard, frame, buffer });
        if (replacing) summary.replaced += 1;
        else summary.imported += 1;
      } catch (error) {
        if (error.code === 'STORYBOARD_CHANGED') {
          return res.status(409).json({ error: 'Раскадровка изменилась во время импорта. Обновите страницу.' });
        }
        summary.errors += 1;
      }
    }
    const response = await storyboardResponse(project, req.user._id);
    return res.json({ ...response, importSummary: summary });
  } catch (error) {
    console.error('FLOW_IMPORT_FAILED', error?.code || error?.message);
    return res.status(500).json({ error: 'Не удалось импортировать результаты Google Flow' });
  }
});

router.post('/:id/storyboard/frames/:frameId/import-flow-image', ensureAuthenticated, parseFlowFrameImageUpload, async (req, res) => {
  try {
    const sourceStoryboardRevision = Number(req.body?.sourceStoryboardRevision);
    if (!Number.isSafeInteger(sourceStoryboardRevision) || sourceStoryboardRevision < 1 || !req.file?.buffer) {
      return res.status(400).json({ error: 'Нужны изображение и версия раскадровки' });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    const frame = storyboard.frames.find(item => item.id === req.params.frameId);
    if (!frame) return res.status(404).json({ error: 'Кадр не найден' });
    if (storyboard.status !== 'confirmed' || storyboard.revision !== sourceStoryboardRevision ||
        !storyboardIsCurrent(project, storyboard)) {
      return res.status(409).json({ error: 'Раскадровка изменилась. Обновите страницу.' });
    }
    await saveFlowStoryboardImage({ project, userId: req.user._id, storyboard, frame, buffer: req.file.buffer });
    if (req.query.compact === '1') {
      return res.json({ success: true, frameId: frame.id, status: 'ready' });
    }
    return res.json(await storyboardResponse(project, req.user._id));
  } catch (error) {
    if (['INVALID_IMAGE_FILE', 'INVALID_STORAGE_KEY'].includes(error.code)) {
      return res.status(400).json({ error: 'Поддерживаются только PNG, JPEG и WebP до 15 МБ' });
    }
    if (error.code === 'STORYBOARD_CHANGED') return res.status(409).json({ error: 'Раскадровка изменилась.' });
    return res.status(500).json({ error: 'Не удалось импортировать изображение Flow' });
  }
});

router.post('/:id/storyboard/frames/:frameId/generate-image', ensureAuthenticated, async (req, res) => {
  let generatedFile = null;
  let previousStorageKey = '';
  let failureContext = null;
  let generatedFileCommitted = false;
  try {
    const { profileId, sourceStoryboardRevision } = req.body || {};
    if (Object.keys(req.body || {}).some(key => !['profileId', 'sourceStoryboardRevision'].includes(key)) ||
        typeof profileId !== 'string' || !profileId ||
        !Number.isSafeInteger(sourceStoryboardRevision) || sourceStoryboardRevision < 1) {
      return res.status(400).json({ error: 'Выберите профиль и обновите раскадровку' });
    }
    const owner = { _id: req.params.id, userId: req.user._id };
    const project = await Project.findOne(owner);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const storyboard = normalizeStoryboard(project);
    const frame = storyboard.frames.find(item => item.id === req.params.frameId);
    if (!frame) return res.status(404).json({ error: 'Кадр не найден' });
    if (storyboard.status !== 'confirmed' || storyboard.revision !== sourceStoryboardRevision ||
        !storyboardIsCurrent(project, storyboard)) {
      return res.status(409).json({ error: 'Раскадровка изменилась. Обновите страницу.' });
    }
    const settings = await Settings.findOne({ userId: req.user._id });
    const profile = settings?.profiles?.id(profileId);
    if (!profile || profile.type !== 'image' || profile.provider !== 'google_studio') {
      return res.status(400).json({ code: 'INVALID_IMAGE_PROFILE', error: 'Выберите профиль изображения Google Studio.' });
    }
    logProfileUsage('generate-storyboard-image', profile, 'image');

    const previous = await StoryboardImage.findOne({
      projectId: project._id, userId: req.user._id, frameId: frame.id,
    }).select('+storageKey');
    previousStorageKey = previous?.storageKey || '';
    failureContext = {
      projectId: project._id, userId: req.user._id, frameId: frame.id,
      sourceStoryboardRevision, sourcePrompt: frame.prompt,
    };
    await StoryboardImage.findOneAndUpdate(
      { projectId: project._id, userId: req.user._id, frameId: frame.id },
      {
        $set: {
          sourceStoryboardRevision, sourcePrompt: frame.prompt, sourceReferenceIds: frame.referenceIds,
          status: 'generating', profileId: profile._id.toString(),
          model: profile.imageSettings?.model?.trim() || 'gemini-3.1-flash-image', errorCode: '',
        },
        $setOnInsert: { projectId: project._id, userId: req.user._id, frameId: frame.id },
      },
      { upsert: true, runValidators: true },
    );

    const selectedItems = (project.referencePlan?.items || []).filter(item =>
      item.selected && frame.referenceIds.includes(item.id));
    const referenceAssets = await VisualReference.find({
      projectId: project._id, userId: req.user._id,
      referenceId: { $in: selectedItems.map(item => item.id) }, status: 'ready',
    }).select('+storageKey');
    const assetByReference = new Map(referenceAssets.map(asset => [asset.referenceId, asset]));
    const references = (await Promise.all(selectedItems.map(async item => {
      const asset = assetByReference.get(item.id);
      if (!asset || asset.sourceReferenceVersion !== item.version || !asset.storageKey) return null;
      try {
        return {
          name: item.name, type: item.type, mimeType: asset.mimeType,
          buffer: await readVisualReferenceFile(asset.storageKey, project.projectPath, req.user._id),
        };
      } catch {
        return null;
      }
    }))).filter(Boolean);

    const generated = await generateGoogleStoryboardImage({ frame, references, profile });
    generatedFile = await saveStoryboardImageFile({
      projectId: project._id.toString(), frameId: frame.id, projectPath: project.projectPath,
      project, userId: req.user._id,
      fileBaseName: storyboardFrameFileBase(project, frame), buffer: generated.buffer,
    });
    const stillCurrent = await Project.exists({
      ...owner, 'storyboard.status': 'confirmed', 'storyboard.revision': sourceStoryboardRevision,
      'storyboard.frames': { $elemMatch: { id: frame.id, prompt: frame.prompt, referenceIds: frame.referenceIds } },
    });
    if (!stillCurrent) {
      await rollbackStoryboardImageFile(generatedFile).catch(() => {});
      generatedFile = null;
      return res.status(409).json({ error: 'Раскадровка изменилась во время генерации. Повторите запрос.' });
    }
    const savedImage = await StoryboardImage.findOneAndUpdate({
      projectId: project._id, userId: req.user._id, frameId: frame.id,
      sourceStoryboardRevision, sourcePrompt: frame.prompt, status: 'generating',
    }, { $set: {
      status: 'ready', storageKey: generatedFile.storageKey, mimeType: generatedFile.mimeType,
      byteSize: generatedFile.byteSize, model: generated.model, generatedAt: new Date(), errorCode: '',
    } }, { new: true, runValidators: true });
    if (!savedImage) {
      await rollbackStoryboardImageFile(generatedFile).catch(() => {});
      generatedFile = null;
      return res.status(409).json({ error: 'Состояние генерации изменилось. Повторите запрос.' });
    }
    await commitStoryboardImageFile(generatedFile);
    generatedFileCommitted = true;
    if (previousStorageKey && previousStorageKey !== generatedFile.storageKey) {
      deleteStoryboardImageFile(previousStorageKey, project.projectPath, req.user._id).catch(() => console.error('STORYBOARD_IMAGE_OLD_FILE_DELETE_FAILED'));
    }
    return res.json(await storyboardResponse(project, req.user._id));
  } catch (error) {
    if (generatedFile?.storageKey && !generatedFileCommitted) await rollbackStoryboardImageFile(generatedFile).catch(() => {});
    if (failureContext) {
      await StoryboardImage.updateOne(failureContext, {
        $set: { status: 'error', errorCode: error.code || 'IMAGE_GENERATION_FAILED' },
      }).catch(() => {});
    }
    if (error?.publicMessage) return res.status(502).json({ code: error.code, error: error.publicMessage });
    if (['INVALID_IMAGE_FILE', 'STORYBOARD_IMAGE_STORAGE_FAILED'].includes(error.code)) {
      return res.status(500).json({ code: error.code, error: 'Не удалось сохранить изображение кадра.' });
    }
    return res.status(500).json({ error: 'Не удалось сгенерировать изображение кадра' });
  }
});

router.get('/:id/storyboard/frames/:frameId/image', ensureAuthenticated, async (req, res) => {
  try {
    const image = await StoryboardImage.findOne({
      projectId: req.params.id, userId: req.user._id, frameId: req.params.frameId, status: 'ready',
    }).select('+storageKey');
    if (!image?.storageKey) return res.status(404).json({ error: 'Изображение кадра не найдено' });
    const projectCurrent = await Project.findOne({
      _id: req.params.id, userId: req.user._id, 'storyboard.status': 'confirmed',
      'storyboard.frames': { $elemMatch: {
        id: image.frameId, prompt: image.sourcePrompt, referenceIds: image.sourceReferenceIds,
      } },
    });
    if (!projectCurrent) return res.status(404).json({ error: 'Изображение кадра устарело' });
    const original = await readStoryboardImageFile(image.storageKey, projectCurrent.projectPath, req.user._id);
    const download = req.query.download === '1';
    const preview = req.query.preview === '1' && !download;
    const buffer = preview ? await createStoryboardImagePreview(original) : original;
    res.set('Content-Type', preview ? 'image/webp' : image.mimeType);
    res.set('Cache-Control', download
      ? 'private, no-store'
      : 'private, max-age=31536000, immutable');
    if (download) {
      const extension = image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const frame = projectCurrent.storyboard.frames.find(item => item.id === image.frameId);
      const filename = frame ? storyboardFrameFileBase(projectCurrent, frame) : `frame_${image.frameId}`;
      res.set('Content-Disposition', `attachment; filename="${filename}.${extension}"`);
    }
    return res.send(buffer);
  } catch (error) {
    if (['STORYBOARD_IMAGE_FILE_NOT_FOUND', 'INVALID_STORAGE_KEY'].includes(error.code)) {
      return res.status(404).json({ error: 'Файл изображения не найден' });
    }
    if (error.code === 'STORYBOARD_IMAGE_PREVIEW_FAILED') {
      return res.status(422).json({ error: 'Не удалось подготовить превью изображения' });
    }
    return res.status(500).json({ error: 'Не удалось загрузить изображение кадра' });
  }
});

router.post('/:id/visual-references/:referenceId/upload', ensureAuthenticated, parseVisualReferenceUpload, async (req, res) => {
  let storedFile;
  let committed = false;
  let referenceProjectPath = '';
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: "Проект не найден" });
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const sourceReferenceVersion = parseVisualReferenceVersion(req.body?.sourceReferenceVersion);
    if (Object.keys(req.body || {}).some(key => !["prompt", "sourceReferenceVersion"].includes(key)) ||
        !prompt || prompt.length > 12000 || !sourceReferenceVersion || !req.file?.buffer) {
      return res.status(400).json({ error: "Нужны изображение, prompt и версия референса" });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    referenceProjectPath = project.projectPath;
    const plan = normalizeReferencePlan(project);
    const item = plan.items.find(value => value.id === req.params.referenceId);
    if (plan.status !== 'confirmed' || !item?.selected || item.version !== sourceReferenceVersion || item.prompt !== prompt) {
      return res.status(409).json({ error: "Референс изменился. Утвердите план и повторите загрузку." });
    }
    storedFile = await saveVisualReferenceFile({
      projectId: project._id.toString(), projectPath: project.projectPath,
      project, userId: req.user._id, referenceId: req.params.referenceId, buffer: req.file.buffer,
    });
    const currentProject = await Project.exists({
      _id: project._id, userId: req.user._id,
      'referencePlan.status': 'confirmed',
      'referencePlan.items': { $elemMatch: { id: req.params.referenceId, selected: true, version: sourceReferenceVersion, prompt } },
    });
    if (!currentProject) {
      await deleteVisualReferenceFile(storedFile.storageKey, project.projectPath, req.user._id).catch(() => {});
      storedFile = null;
      return res.status(409).json({ error: "Референс изменился. Утвердите план и повторите загрузку." });
    }
    let replaced;
    try {
      replaced = await VisualReference.findOneAndUpdate(
        { projectId: project._id, userId: req.user._id, referenceId: req.params.referenceId },
        { $set: {
          sourceReferenceVersion, status: "ready", entityCollection: 'references', entityId: req.params.referenceId,
          storageKey: storedFile.storageKey, mimeType: storedFile.mimeType, byteSize: storedFile.byteSize,
          prompt, errorCode: "",
        }, $setOnInsert: { userId: req.user._id, referenceId: req.params.referenceId } },
        { new: false, upsert: true, runValidators: true },
      ).select("+storageKey");
      committed = true;
    } catch {
      await deleteVisualReferenceFile(storedFile.storageKey, project.projectPath, req.user._id).catch(() => {});
      return res.status(500).json({ error: "Не удалось сохранить референс" });
    }
    if (replaced?.storageKey && replaced.storageKey !== storedFile.storageKey) {
      deleteVisualReferenceFile(replaced.storageKey, project.projectPath, req.user._id).catch(() => console.error("VISUAL_REFERENCE_OLD_FILE_DELETE_FAILED"));
    }
    const reference = await VisualReference.findOne({
      projectId: project._id, userId: req.user._id, referenceId: req.params.referenceId,
    });
    if (!reference) return res.status(500).json({ error: "Не удалось сохранить референс" });
    return res.json({ success: true, reference: visualReferenceMetadata(reference, item) });
  } catch (error) {
    if (storedFile && !committed) await deleteVisualReferenceFile(storedFile.storageKey, referenceProjectPath, req.user?._id).catch(() => {});
    if (["INVALID_IMAGE_FILE", "INVALID_STORAGE_KEY"].includes(error.code)) {
      return res.status(400).json({ error: "Поддерживаются только PNG, JPEG и WebP изображения" });
    }
    return res.status(500).json({ error: "Не удалось сохранить файл референса" });
  }
});

router.get('/:id/visual-references/:referenceId/image', ensureAuthenticated, async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id) || !/^[a-f\d]{24}$/i.test(req.params.referenceId)) {
      return res.status(404).json({ error: "Референс не найден" });
    }
    const reference = await VisualReference.findOne({ _id: req.params.referenceId, projectId: req.params.id, userId: req.user._id })
      .select("+storageKey");
    if (!reference) return res.status(404).json({ error: "Референс не найден" });
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    let image;
    try {
      image = await readVisualReferenceFile(reference.storageKey, project.projectPath, req.user._id);
    } catch (error) {
      if (["VISUAL_REFERENCE_FILE_NOT_FOUND", "INVALID_STORAGE_KEY"].includes(error.code)) {
        return res.status(404).json({ error: "Файл референса не найден" });
      }
      throw error;
    }
    res.set("Content-Type", reference.mimeType);
    res.set("Cache-Control", "private, no-store");
    return res.send(image);
  } catch {
    return res.status(500).json({ error: "Не удалось загрузить файл референса" });
  }
});

router.delete('/:id/visual-references/:referenceId', ensureAuthenticated, async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id) || !/^[a-f\d]{24}$/i.test(req.params.referenceId)) {
      return res.status(404).json({ error: "Референс не найден" });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    const reference = await VisualReference.findOneAndDelete({
      _id: req.params.referenceId, projectId: req.params.id, userId: req.user._id,
    }).select("+storageKey");
    if (!reference) return res.status(404).json({ error: "Референс не найден" });
    deleteVisualReferenceFile(reference.storageKey, project.projectPath, req.user._id).catch(() => console.error("VISUAL_REFERENCE_FILE_DELETE_FAILED"));
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Не удалось удалить референс" });
  }
});

function changeBible(action) {
  return async (req, res) => {
    try {
      if (!/^[a-f\d]{24}$/i.test(req.params.id) || !validBibleBody(req.body, action)) {
        return res.status(400).json({ error: 'Неверные параметры Visual Bible' });
      }
      const owner = { _id: req.params.id, userId: req.user._id };
      const project = await Project.findOne(owner);
      if (!project) return res.status(404).json({ error: 'Проект не найден' });
      const bible = normalizeVisualBible(project);
      const status = action === 'reopen' ? 'confirmed' : 'draft';
      const sourceRevision = bible.sourceScriptRevision;
      if (bible.status !== status || bible.editVersion !== req.body.expectedEditVersion ||
          project.script?.status !== 'confirmed' || sourceRevision !== project.script.revision ||
          (action !== 'save' && req.body.sourceScriptRevision !== sourceRevision)) {
        return res.status(409).json({ error: 'Bible или сценарий изменились. Перезагрузите данные.' });
      }
      const now = new Date();
      const set = { 'visualBible.updatedAt': now, updatedAt: now };
      const inc = { 'visualBible.editVersion': 1 };
      if (action === 'save') {
        const { expectedEditVersion, ...input } = req.body;
        const content = validateVisualBibleContent(input, bible);
        for (const [key, value] of Object.entries(content)) set[`visualBible.${key}`] = value;
        set['visualBible.confirmedAt'] = null;
      } else {
        set['visualBible.status'] = action === 'confirm' ? 'confirmed' : 'draft';
        set['visualBible.confirmedAt'] = action === 'confirm' ? now : null;
        if (action === 'confirm') inc['visualBible.revision'] = 1;
      }
      // Compare all lifecycle bindings in the write, including the source script.
      const saved = await Project.findOneAndUpdate({
        ...owner, 'visualBible.status': status,
        'visualBible.editVersion': req.body.expectedEditVersion,
        'visualBible.sourceScriptRevision': sourceRevision,
        'script.status': 'confirmed', 'script.revision': sourceRevision,
      }, { $set: set, $inc: inc }, { new: true, runValidators: true });
      if (!saved) return res.status(409).json({ error: 'Bible или сценарий изменились. Перезагрузите данные.' });
      return res.json(bibleResponse(saved));
    } catch (error) {
      if (error.status === 400 || ['ValidationError', 'CastError', 'StrictModeError'].includes(error.name)) {
        return res.status(400).json({ error: 'Неверное содержимое Visual Bible' });
      }
      return res.status(500).json({ error: 'Не удалось сохранить Visual Bible' });
    }
  };
}

router.put('/:id/visual-bible', ensureAuthenticated, changeBible('save'));
router.post('/:id/visual-bible/confirm', ensureAuthenticated, changeBible('confirm'));
router.post('/:id/visual-bible/reopen', ensureAuthenticated, changeBible('reopen'));

export default router;
