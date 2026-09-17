// server/src/routes/projectRoutes.js
import express from "express";
import multer from "multer";
import { ensureAuthenticated } from "../middleware/auth.js";
import Settings, { DEFAULT_VISUAL_BIBLE_PROMPT, DEFAULT_VISUAL_BIBLE_EDIT_PROMPT, DEFAULT_REFERENCE_ANALYSIS_PROMPT, DEFAULT_REFERENCE_DETAIL_PROMPT } from "../models/Settings.js";
import {
  generateVideoTopic,
  generateCoverData,
  generateScript,
  editScript,
  generateVisualBibleDraft,
  editVisualBible,
  analyzeScriptReferences,
  detailReferencePrompt,
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
import {
  normalizeReferencePlan, parseReferenceAnalysis, validateReferenceItems,
} from "../services/referencePlanService.js";
import path from "path";
import fs from "fs";

const router = express.Router();
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

    // Удаление папки с диска
    if (project.projectPath && fs.existsSync(project.projectPath)) {
      fs.rmSync(project.projectPath, { recursive: true, force: true });
    }

    await project.deleteOne();
    await VisualReference.deleteMany({ projectId: project._id, userId: req.user._id });
    await Promise.all(references.map(reference => deleteVisualReferenceFile(reference.storageKey)
      .catch(() => console.error("VISUAL_REFERENCE_PROJECT_DELETE_FAILED"))));
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

function referencePlanResponse(project, assets = []) {
  const plan = normalizeReferencePlan(project);
  const assetByReference = new Map(assets.map(asset => [asset.referenceId, asset]));
  return {
    success: true,
    scriptStatus: project.script?.status ?? null,
    scriptRevision: project.script?.revision ?? null,
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

async function removeOrphanReferenceAssets(projectId, userId, retainedIds) {
  const orphans = await VisualReference.find({
    projectId, userId, referenceId: { $nin: retainedIds },
  }).select('+storageKey');
  if (!orphans.length) return;
  await VisualReference.deleteMany({ _id: { $in: orphans.map(item => item._id) }, projectId, userId });
  await Promise.all(orphans.map(item => deleteVisualReferenceFile(item.storageKey)
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
        plan.editVersion !== body.expectedEditVersion) {
      return res.status(409).json({ error: 'Сценарий или список референсов изменились. Обновите страницу.' });
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
      ...owner, 'script.status': 'confirmed', 'script.revision': body.sourceScriptRevision, ...versionFilter,
    }, { $set: {
      referencePlan: {
        status: 'draft', revision: plan.revision || 0, editVersion: body.expectedEditVersion + 1,
        sourceScriptRevision: body.sourceScriptRevision, instructions: body.instructions.trim(), items,
        updatedAt: now, confirmedAt: null,
      }, updatedAt: now,
    } }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Сценарий или список референсов изменились. Обновите страницу.' });
    await removeOrphanReferenceAssets(saved._id, req.user._id, items.map(item => item.id));
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
    await removeOrphanReferenceAssets(saved._id, req.user._id, items.map(item => item.id));
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
      'script.revision': body.sourceScriptRevision, 'referencePlan.editVersion': body.expectedEditVersion,
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

router.post('/:id/visual-references/:referenceId/upload', ensureAuthenticated, parseVisualReferenceUpload, async (req, res) => {
  let storedFile;
  let committed = false;
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
    const plan = normalizeReferencePlan(project);
    const item = plan.items.find(value => value.id === req.params.referenceId);
    if (plan.status !== 'confirmed' || !item?.selected || item.version !== sourceReferenceVersion || item.prompt !== prompt) {
      return res.status(409).json({ error: "Референс изменился. Утвердите план и повторите загрузку." });
    }
    storedFile = await saveVisualReferenceFile({
      projectId: project._id.toString(), referenceId: req.params.referenceId, buffer: req.file.buffer,
    });
    const currentProject = await Project.exists({
      _id: project._id, userId: req.user._id,
      'referencePlan.status': 'confirmed',
      'referencePlan.items': { $elemMatch: { id: req.params.referenceId, selected: true, version: sourceReferenceVersion, prompt } },
    });
    if (!currentProject) {
      await deleteVisualReferenceFile(storedFile.storageKey).catch(() => {});
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
      await deleteVisualReferenceFile(storedFile.storageKey).catch(() => {});
      return res.status(500).json({ error: "Не удалось сохранить референс" });
    }
    if (replaced?.storageKey && replaced.storageKey !== storedFile.storageKey) {
      deleteVisualReferenceFile(replaced.storageKey).catch(() => console.error("VISUAL_REFERENCE_OLD_FILE_DELETE_FAILED"));
    }
    const reference = await VisualReference.findOne({
      projectId: project._id, userId: req.user._id, referenceId: req.params.referenceId,
    });
    if (!reference) return res.status(500).json({ error: "Не удалось сохранить референс" });
    return res.json({ success: true, reference: visualReferenceMetadata(reference, item) });
  } catch (error) {
    if (storedFile && !committed) await deleteVisualReferenceFile(storedFile.storageKey).catch(() => {});
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
