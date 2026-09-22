import express from 'express';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import StoryboardImage from '../models/StoryboardImage.js';
import StoryboardVideo from '../models/StoryboardVideo.js';
import { ensureAuthenticated } from '../middleware/auth.js';
import multer from 'multer';
import { normalizeVideoPlan, patchVideoPlan, videoPlanResponse } from '../services/videoPlanService.js';
import { hasAudioDuration, inspectAudioBlock } from '../services/audioDuration.js';
import { readVoiceoverAudio } from '../services/voiceoverStorage.js';
import { readStoryboardVideoFile } from '../services/storyboardVideoStorage.js';
import { readStoryboardImageFile } from '../services/storyboardImageStorage.js';
import { createFlowVideoExportPackage, verifyFlowVideoExportSnapshot } from '../services/flowVideoPackageService.js';
import { importFlowVideoSingleFrame } from '../services/flowVideoImportService.js';
import { classifyFlowVideoError } from '../services/flowVideoValidation.js';

import Settings from '../models/Settings.js';
import { analysisChunks, assertVideoVersion, analysisPrompt, applyAnalysis, preparationPrompt,
  selectionRulesPrompt, beginVideoAnalysis, assertAnalysisCurrent, applyPreparedPrompt, confirmVideoPlan, resetVideoPrompts, classifyVideoError, videoError } from '../services/videoPlanAiService.js';
const router = express.Router();

const flowVideoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024, files: 1, fields: 1, parts: 3 },
});

function parseFlowVideoUpload(req, res, next) {
  flowVideoUpload.single('video')(req, res, error => {
    if (!error) return next();
    const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST',
      error: tooLarge ? 'Размер видео превышает лимит 64 МБ' : 'Некорректная загрузка видео',
    });
  });
}

async function response(project, userId) {
  // Backfill duration in memory for legacy MP3s using the same reader as export.
  for (const block of project.voiceover?.blocks || []) {
    if (!hasAudioDuration(block.audioDurationSec) && block.audioStatus === 'ready' && block.audioStorageKey)
      await inspectAudioBlock(block, { read: key => readVoiceoverAudio(key, project.projectPath, userId), persist: async () => {} });
  }
  const owner = { projectId: project._id, userId };
  const [images, videos] = await Promise.all([
    StoryboardImage.find(owner).select('+storageKey'), StoryboardVideo.find(owner),
  ]);
  return { ...videoPlanResponse(project, images, videos), analysisChunks: analysisChunks(project) };
}
const errorResponse = (res, error) => {
  const safe = classifyVideoError(error);
  if (safe.retryAfterMs && res.set) res.set('Retry-After', String(Math.ceil(safe.retryAfterMs / 1000)));
  return res.status(safe.status).json({ success: false, ...safe });
};

const flowErrorResponse = (res, error) => {
  const safe = classifyFlowVideoError(error);
  return res.status(safe.status).json({ success: false, ...safe });
};
async function ownedProject(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ success: false, code: 'INVALID_PROJECT_ID', error: 'Некорректный проект.' }); return null;
  }
  const project = await Project.findOne({ _id: req.params.id, userId: req.user._id }).select('+voiceover.blocks.audioStorageKey');
  if (!project) res.status(404).json({ success: false, code: 'PROJECT_NOT_FOUND', error: 'Проект не найден.' });
  return project;
}

async function requireOwnedProject(req, res, next) {
  try {
    const project = await ownedProject(req, res);
    if (!project) return;
    req.project = project;
    next();
  } catch (error) {
    flowErrorResponse(res, error);
  }
}

router.get('/:id/video-plan', ensureAuthenticated, async (req, res) => {
  try {
    const project = await ownedProject(req, res);
    if (project) res.json(await response(project, req.user._id));
  } catch (error) { errorResponse(res, error); }
});

router.get('/:id/video-plan/frames/:frameId/video', ensureAuthenticated, async (req, res) => {
  try {
    const project = await ownedProject(req, res);
    if (!project) return;
    const video = await StoryboardVideo.findOne({
      projectId: project._id,
      userId: req.user._id,
      frameId: req.params.frameId,
      status: 'ready',
    }).select('+storageKey');
    if (!video?.storageKey) return res.status(404).json({ success: false, code: 'VIDEO_NOT_FOUND', error: 'Видео кадра не найдено.' });
    const buffer = await readStoryboardVideoFile(video.storageKey, project.projectPath, req.user._id);
    if (!Buffer.isBuffer(buffer)) return res.status(404).json({ success: false, code: 'VIDEO_NOT_FOUND', error: 'Видео кадра недоступно.' });
    res.set('Content-Type', 'video/mp4');
    res.set('Content-Length', String(buffer.length));
    res.set('Cache-Control', 'private, no-store');
    return res.send(buffer);
  } catch (error) { flowErrorResponse(res, error); }
});

router.get('/:id/video-plan/flow/export', ensureAuthenticated, async (req, res) => {
  try {
    const project = await ownedProject(req, res);
    if (!project) return;

    const rawVersion = req.query.expectedEditVersion;
    if (rawVersion === undefined || rawVersion === null || rawVersion === '' || !/^\d+$/.test(String(rawVersion))) {
      return res.status(400).json({ success: false, code: 'INVALID_VIDEO_PLAN_VERSION', error: 'Некорректная версия видеоплана' });
    }
    const expectedEditVersion = Number(rawVersion);
    if (!Number.isSafeInteger(expectedEditVersion) || expectedEditVersion < 0) {
      return res.status(400).json({ success: false, code: 'INVALID_VIDEO_PLAN_VERSION', error: 'Некорректная версия видеоплана' });
    }

    const currentPlan = normalizeVideoPlan(project);
    if (currentPlan.editVersion !== expectedEditVersion) {
      return res.status(409).json({ success: false, code: 'VIDEO_PLAN_CONFLICT', error: 'Видеоплан изменился. Обновите данные.' });
    }

    const owner = { projectId: project._id, userId: req.user._id };
    const [images, videos] = await Promise.all([
      StoryboardImage.find(owner).select('+storageKey'),
      StoryboardVideo.find(owner),
    ]);

    const pkg = await createFlowVideoExportPackage({
      project,
      images,
      videos,
      readImageFile: key => readStoryboardImageFile(key, project.projectPath, req.user._id),
    });

    const [freshProject, freshImages] = await Promise.all([
      Project.findOne({ _id: project._id, userId: req.user._id }),
      StoryboardImage.find(owner).select('+storageKey'),
    ]);

    if (!freshProject) {
      return res.status(404).json({ success: false, code: 'PROJECT_NOT_FOUND', error: 'Проект не найден' });
    }

    verifyFlowVideoExportSnapshot({
      project: freshProject,
      images: freshImages,
      expectedFrames: pkg.frames,
      expectedStoryboardRevision: pkg.storyboardRevision,
      expectedVideoPlanRevision: pkg.videoPlanRevision,
      expectedEditVersion: pkg.editVersion,
      expectedSelectedFrameIds: pkg.selectedFrameIds,
    });

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${pkg.filename}"`);
    res.set('Cache-Control', 'private, no-store');
    return res.send(pkg.zipBuffer);
  } catch (error) { flowErrorResponse(res, error); }
});

router.patch('/:id/video-plan', ensureAuthenticated, async (req, res) => {
  try {
    const project = await ownedProject(req, res);
    if (!project) return;
    const videoPlan = patchVideoPlan(project, req.body);
    const filter = { _id: project._id, userId: req.user._id,
      // Exact source snapshot also catches edits that do not increment revision.
      storyboard: project.storyboard?.toObject ? project.storyboard.toObject() : project.storyboard ?? { $exists: false },
      ...(project.videoPlan ? { 'videoPlan.editVersion': req.body.expectedEditVersion }
        : { videoPlan: { $exists: false } }),
    };
    const saved = await Project.findOneAndUpdate(filter, { $set: { videoPlan, updatedAt: new Date() } },
      { new: true, runValidators: true }).select('+voiceover.blocks.audioStorageKey');
    if (!saved) return errorResponse(res, { status: 409, code: 'VIDEO_PLAN_CONFLICT' });
    return res.json(await response(saved, req.user._id));
  } catch (error) { errorResponse(res, error); }
});

// Every operation commits one bounded result with a compare-and-swap guard.
async function commitPlan(project, userId, videoPlan, sourceSnapshot) {
  const snapshot = value => value?.toObject ? value.toObject() : value;
  const filter = { _id: project._id, userId,
    storyboard: snapshot(project.storyboard),
    voiceover: sourceSnapshot.voiceover ?? { $exists: false },
    referencePlan: sourceSnapshot.referencePlan ?? { $exists: false },
    ...(project.videoPlan ? { 'videoPlan.editVersion': project.videoPlan.editVersion }
      : { videoPlan: { $exists: false } }),
  };
  const saved = await Project.findOneAndUpdate(filter, { $set: { videoPlan, updatedAt: new Date() } },
    { new: true, runValidators: true }).select('+voiceover.blocks.audioStorageKey');
  if (!saved) throw videoError('VIDEO_PLAN_CONFLICT', 409);
  return saved;
}
export const videoAi = {
  async generate(prompt, settings, json) {
    const { generateVideoPlanText } = await import('../services/geminiService.js');
    const { resolveProfile } = await import('../services/aiProfileResolver.js');
    return generateVideoPlanText(prompt, resolveProfile(settings, 'text'), json);
  },
};
router.post('/:id/video-plan/:action', ensureAuthenticated, async (req, res) => {
  try {
    const project = await ownedProject(req, res);
    if (!project) return;
    const { action } = req.params;
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(k => !['expectedEditVersion', 'chunkIndex', 'frameId'].includes(k)))
      throw videoError('INVALID_VIDEO_PLAN');
    assertVideoVersion(project, body.expectedEditVersion);
    const sourceSnapshot = { voiceover: project.voiceover?.toObject ? project.voiceover.toObject() : structuredClone(project.voiceover),
      referencePlan: project.referencePlan?.toObject ? project.referencePlan.toObject() : structuredClone(project.referencePlan) };
    let plan;
    if (action === 'confirm') plan = confirmVideoPlan(project, body.expectedEditVersion);
    else if (action === 'reset') plan = resetVideoPrompts(project, body.expectedEditVersion);
    else if (action === 'analyze-start') {
      const settings = await Settings.findOne({ userId: req.user._id });
      const text = await videoAi.generate(selectionRulesPrompt(project), settings, true);
      plan = beginVideoAnalysis(project, text, body.expectedEditVersion);
    } else if (action === 'analyze' || action === 'prepare') {
      const current = await response(project, req.user._id);
      if (current.timingErrorCode) throw videoError('FRAME_CHANGED', 409);
      const settings = await Settings.findOne({ userId: req.user._id });
      let prompt, chunk;
      if (action === 'analyze') {
        assertAnalysisCurrent(project);
        if (!Number.isSafeInteger(body.chunkIndex) || !(chunk = current.analysisChunks[body.chunkIndex]))
          throw videoError('INVALID_VIDEO_PLAN');
        prompt = analysisPrompt(project, chunk, current, settings?.prompts?.videoPlanAnalysisPrompt);
      } else prompt = preparationPrompt(project, body.frameId, current, settings?.prompts?.videoPromptPreparationPrompt);
      const text = await videoAi.generate(prompt, settings, action === 'analyze');
      plan = action === 'analyze' ? applyAnalysis(project, chunk, text, body.expectedEditVersion)
        : applyPreparedPrompt(project, body.frameId, text, body.expectedEditVersion);
    } else throw videoError('INVALID_VIDEO_PLAN');
    const saved = await commitPlan(project, req.user._id, plan, sourceSnapshot);
    res.json(await response(saved, req.user._id));
  } catch (error) {
    if (['analyze-start', 'analyze', 'prepare'].includes(req.params.action)) {
      console.error('[VIDEO_PLAN_PROVIDER_ERROR]', {
        action: req.params.action,
        status: error?.status ?? error?.statusCode ?? error?.response?.status ?? null,
        code: typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : null,
        message: String(error?.message || '').slice(0, 500),
      });
    }
    errorResponse(res, error);
  }
});

router.post('/:id/video-plan/frames/:frameId/import-flow-video', ensureAuthenticated, requireOwnedProject, parseFlowVideoUpload, async (req, res) => {
  try {
    const project = req.project;

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, code: 'INVALID_REQUEST', error: 'Необходимо прикрепить MP4 видеофайл' });
    }

    const inputFingerprint = req.body?.inputFingerprint;
    if (typeof inputFingerprint !== 'string' || !/^[0-9a-fA-F]{64}$/.test(inputFingerprint)) {
      return res.status(400).json({ success: false, code: 'INVALID_INPUT_FINGERPRINT', error: 'Некорректный отпечаток кадра (inputFingerprint)' });
    }

    const result = await importFlowVideoSingleFrame({
      project,
      userId: req.user._id,
      frameId: req.params.frameId,
      inputFingerprint,
      fileBuffer: req.file.buffer,
      uploadedFilename: req.file.originalname,
    });

    return res.json(result);
  } catch (error) { flowErrorResponse(res, error); }
});
export default router;
