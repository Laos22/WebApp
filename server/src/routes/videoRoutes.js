import express from 'express';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import StoryboardImage from '../models/StoryboardImage.js';
import StoryboardVideo from '../models/StoryboardVideo.js';
import { ensureAuthenticated } from '../middleware/auth.js';
import { patchVideoPlan, videoPlanResponse } from '../services/videoPlanService.js';
import { hasAudioDuration, inspectAudioBlock } from '../services/audioDuration.js';
import { readVoiceoverAudio } from '../services/voiceoverStorage.js';

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
  return videoPlanResponse(project, images, videos);
}
const errorResponse = (res, error) => res.status(error.status || 500).json({ success: false,
  code: error.status ? error.code : 'VIDEO_PLAN_FAILED',
  error: error.status === 409 ? 'План или раскадровка изменились. Обновите данные перед сохранением.'
    : error.status === 400 ? 'Некорректные данные видеоплана.' : 'Не удалось обработать видеоплан.' });
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
export default router;
