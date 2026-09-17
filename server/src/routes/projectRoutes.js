// server/src/routes/projectRoutes.js
import express from "express";
import multer from "multer";
import { ensureAuthenticated } from "../middleware/auth.js";
import Settings, { DEFAULT_VISUAL_BIBLE_PROMPT, DEFAULT_VISUAL_BIBLE_EDIT_PROMPT } from "../models/Settings.js";
import {
  generateVideoTopic,
  generateCoverData,
  generateScript,
  editScript,
  generateVisualBibleDraft,
  editVisualBible,
} from "../services/geminiService.js";
import {
  resolveProfile,
  logProfileUsage,
} from "../services/aiProfileResolver.js";
import Project from "../models/Project.js";
import VisualReference from "../models/VisualReference.js";
import {
  normalizeVisualBible, validateVisualBibleContent, markVisualBibleStaleUpdate,
  normalizeGeneratedVisualBible,
  normalizeEditedVisualBible,
} from "../services/visualBibleService.js";
import {
  MAX_VISUAL_REFERENCE_BYTES, saveVisualReferenceFile, readVisualReferenceFile,
  deleteVisualReferenceFile,
} from "../services/visualReferenceStorage.js";
import { buildVisualReferencePrompt } from "../services/visualReferencePrompt.js";
import path from "path";
import fs from "fs";

const router = express.Router();
const referenceCollections = new Set(["characters", "locations", "objects"]);
const visualReferenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VISUAL_REFERENCE_BYTES, files: 1, fields: 3, parts: 4 },
});

function parseVisualReferenceUpload(req, res, next) {
  visualReferenceUpload.single("image")(req, res, error => {
    if (!error) return next();
    return res.status(error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
      .json({ error: "Некорректный файл референса" });
  });
}

function visualReferenceMetadata(reference, bible) {
  return {
    id: reference._id.toString(), entityCollection: reference.entityCollection,
    entityId: reference.entityId, sourceBibleRevision: reference.sourceBibleRevision,
    sourceBibleEditVersion: reference.sourceBibleEditVersion, status: reference.status,
    mimeType: reference.mimeType, byteSize: reference.byteSize, prompt: reference.prompt,
    errorCode: reference.errorCode, createdAt: reference.createdAt, updatedAt: reference.updatedAt,
    stale: bible.status !== "confirmed" || reference.sourceBibleRevision !== bible.revision ||
      reference.sourceBibleEditVersion !== bible.editVersion,
  };
}

function referenceEntity(bible, entityCollection, entityId) {
  if (!referenceCollections.has(entityCollection) || typeof entityId !== "string") return null;
  return bible[entityCollection]?.find(entity => entity.id === entityId) ?? null;
}

export function parseVisualReferenceVersion(value) {
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

    // Удаление папки с диска
    if (project.projectPath && fs.existsSync(project.projectPath)) {
      fs.rmSync(project.projectPath, { recursive: true, force: true });
    }

    await project.deleteOne();
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

    // Создаем папку на диске в папке server/uploads в режиме разработки
    // для продакшена нужно использовать синхронизацию с гугл драйв через сервис driveSync.js
    const uploadsDir = path.join(process.cwd(), "uploads", short_title);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      // Создаем  файл project_state.json в папке проекта
      const projectStateFile = path.join(uploadsDir, "project_state.json");
      if (!fs.existsSync(projectStateFile)) {
        fs.writeFileSync(projectStateFile, JSON.stringify({}));
        //записываем ту тему и описание, которая была сгенерирована в файл project_state.json
        fs.writeFileSync(
          projectStateFile,
          JSON.stringify({ topic, description, short_title }),
        );
      }
    }
    // если папка уже существует, то просто обновляем файл project_state.json
    else {
      const projectStateFile = path.join(uploadsDir, "project_state.json");
      fs.writeFileSync(
        projectStateFile,
        JSON.stringify({ short_title, topic, description }),
      );
    }

    // Создаем проект в БД
    const project = await Project.create({
      userId: req.user._id,
      title: topic, // Название проекта = полное название темы
      description: description,
      shortTitle: short_title,
      keywords: keywords || "",
      projectPath: uploadsDir, // добавляем путь к папке проекта на диске в БД
    });

    res.json({
      success: true,
      projectId: project._id,
      shortTitle: short_title,
      projectPath: uploadsDir,
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

    // Сохраняем данные в project_state.json
    const projectStateFile = path.join(
      project.projectPath,
      "project_state.json",
    );
    let projectState = {};

    if (fs.existsSync(projectStateFile)) {
      projectState = JSON.parse(fs.readFileSync(projectStateFile, "utf-8"));
    }

    projectState.coverData = coverData;
    fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2));

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
    const warning = mirrorScript(saved);
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
function mirrorScript(project) {
  try {
    if (!project.projectPath) throw new Error("Missing project path");
    const file = path.join(project.projectPath, "project_state.json");
    const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : {};
    state.generatedScript = project.script.content;
    fs.mkdirSync(project.projectPath, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    return undefined;
  } catch {
    return "Сценарий сохранён в MongoDB, но локальную копию обновить не удалось.";
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
    const warning = mirrorScript(saved);
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
    const warning = mirrorScript(saved);
    res.json({ success: true, script: saved.script, warning });
  } catch {
    res.status(500).json({ error: "Не удалось подтвердить сценарий в MongoDB" });
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

router.get('/:id/visual-references', ensureAuthenticated, async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: "Проект не найден" });
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    const bible = normalizeVisualBible(project);
    const references = await VisualReference.find({ projectId: project._id, userId: req.user._id });
    return res.json({ success: true, references: references.map(reference => visualReferenceMetadata(reference, bible)) });
  } catch {
    return res.status(500).json({ error: "Не удалось загрузить референсы" });
  }
});

router.get('/:id/visual-references/:entityCollection/:entityId/flow-prompt', ensureAuthenticated, async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: "Проект не найден" });
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    const bible = normalizeVisualBible(project);
    if (bible.status !== "confirmed") return res.status(409).json({ error: "Visual Bible должна быть подтверждена" });
    const entity = referenceEntity(bible, req.params.entityCollection, req.params.entityId);
    if (!entity) return res.status(400).json({ error: "Некорректная сущность референса" });
    const settings = await Settings.findOne({ userId: req.user._id });
    let prompt;
    try {
      prompt = buildVisualReferencePrompt(project, bible, req.params.entityCollection, entity, settings?.prompts?.visualReferencePrompt);
    } catch (error) {
      if (error.code === "FLOW_PROMPT_TOO_LONG") return res.status(400).json({ code: error.code });
      throw error;
    }
    return res.json({
      success: true, prompt, entityCollection: req.params.entityCollection, entityId: req.params.entityId,
      sourceBibleRevision: bible.revision, sourceBibleEditVersion: bible.editVersion,
    });
  } catch {
    return res.status(500).json({ error: "Не удалось сформировать prompt для Flow" });
  }
});

router.post('/:id/visual-references/:entityCollection/:entityId/upload', ensureAuthenticated, parseVisualReferenceUpload, async (req, res) => {
  let storedFile;
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: "Проект не найден" });
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const sourceBibleRevision = parseVisualReferenceVersion(req.body?.sourceBibleRevision);
    const sourceBibleEditVersion = parseVisualReferenceVersion(req.body?.sourceBibleEditVersion);
    if (Object.keys(req.body || {}).some(key => !["prompt", "sourceBibleRevision", "sourceBibleEditVersion"].includes(key)) ||
        !prompt || prompt.length > 12000 || sourceBibleRevision === null || sourceBibleEditVersion === null || !req.file?.buffer) {
      return res.status(400).json({ error: "Нужны изображение, prompt и корректные версии Visual Bible" });
    }
    const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    const bible = normalizeVisualBible(project);
    if (bible.status !== "confirmed" || bible.revision !== sourceBibleRevision || bible.editVersion !== sourceBibleEditVersion) {
      return res.status(409).json({ error: "Visual Bible изменилась. Сформируйте новый prompt и повторите загрузку." });
    }
    const entity = referenceEntity(bible, req.params.entityCollection, req.params.entityId);
    if (!entity) return res.status(400).json({ error: "Некорректная сущность референса" });
    storedFile = await saveVisualReferenceFile({
      projectId: project._id.toString(), entityCollection: req.params.entityCollection,
      entityId: req.params.entityId, buffer: req.file.buffer,
    });
    const previous = await VisualReference.findOne({
      projectId: project._id, userId: req.user._id, entityCollection: req.params.entityCollection, entityId: req.params.entityId,
    }).select("+storageKey");
    const currentProject = await Project.exists({
      _id: project._id, userId: req.user._id,
      "visualBible.status": "confirmed", "visualBible.revision": sourceBibleRevision,
      "visualBible.editVersion": sourceBibleEditVersion,
    });
    if (!currentProject) {
      await deleteVisualReferenceFile(storedFile.storageKey).catch(() => {});
      storedFile = null;
      return res.status(409).json({ error: "Visual Bible изменилась. Сформируйте новый prompt и повторите загрузку." });
    }
    let reference;
    try {
      reference = await VisualReference.findOneAndUpdate(
        { projectId: project._id, userId: req.user._id, entityCollection: req.params.entityCollection, entityId: req.params.entityId },
        { $set: {
          sourceBibleRevision, sourceBibleEditVersion, status: "ready",
          storageKey: storedFile.storageKey, mimeType: storedFile.mimeType, byteSize: storedFile.byteSize,
          prompt, errorCode: "",
        }, $setOnInsert: { userId: req.user._id } },
        { new: true, upsert: true, runValidators: true },
      ).select("+storageKey");
    } catch {
      await deleteVisualReferenceFile(storedFile.storageKey).catch(() => {});
      return res.status(500).json({ error: "Не удалось сохранить референс" });
    }
    if (previous?.storageKey && previous.storageKey !== storedFile.storageKey) {
      deleteVisualReferenceFile(previous.storageKey).catch(() => console.error("VISUAL_REFERENCE_OLD_FILE_DELETE_FAILED"));
    }
    return res.json({ success: true, reference: visualReferenceMetadata(reference, bible) });
  } catch (error) {
    if (storedFile) await deleteVisualReferenceFile(storedFile.storageKey).catch(() => {});
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
    let image;
    try {
      image = await readVisualReferenceFile(reference.storageKey);
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
    const reference = await VisualReference.findOneAndDelete({
      _id: req.params.referenceId, projectId: req.params.id, userId: req.user._id,
    }).select("+storageKey");
    if (!reference) return res.status(404).json({ error: "Референс не найден" });
    deleteVisualReferenceFile(reference.storageKey).catch(() => console.error("VISUAL_REFERENCE_FILE_DELETE_FAILED"));
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
