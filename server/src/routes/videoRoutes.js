import express from 'express';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import StoryboardImage from '../models/StoryboardImage.js';
import StoryboardVideo from '../models/StoryboardVideo.js';
import { ensureAuthenticated } from '../middleware/auth.js';
import { patchVideoPlan, videoPlanResponse } from '../services/videoPlanService.js';
import { hasAudioDuration, inspectAudioBlock } from '../services/audioDuration.js';
import { readVoiceoverAudio } from '../services/voiceoverStorage.js';

import Settings from '../models/Settings.js';
import { analysisChunks, assertVideoVersion, analysisPrompt, applyAnalysis, preparationPrompt,
  applyPreparedPrompt, confirmVideoPlan, resetVideoPrompts, classifyVideoError, videoError } from '../services/videoPlanAiService.js';
const router = express.Router();
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
async function ownedProject(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ success: false, code: 'INVALID_PROJECT_ID', error: 'Некорректный проект.' }); return null;
  }
  const project = await Project.findOne({ _id: req.params.id, userId: req.user._id }).select('+voiceover.blocks.audioStorageKey');
  if (!project) res.status(404).json({ success: false, code: 'PROJECT_NOT_FOUND', error: 'Проект не найден.' });
  return project;
}
router.get('/:id/video-plan', ensureAuthenticated, async (req, res) => {
  try {
    const project = await ownedProject(req, res);
    if (project) res.json(await response(project, req.user._id));
  } catch (error) { errorResponse(res, error); }
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
    else if (action === 'analyze' || action === 'prepare') {
      const current = await response(project, req.user._id);
      if (current.timingErrorCode) throw videoError('FRAME_CHANGED', 409);
      const settings = await Settings.findOne({ userId: req.user._id });
      let prompt, chunk;
      if (action === 'analyze') {
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
  } catch (error) { errorResponse(res, error); }
});
export default router;
