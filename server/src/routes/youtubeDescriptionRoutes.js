import express from 'express';
import { ensureAuthenticated } from '../middleware/auth.js';
import Project from '../models/Project.js';
import Settings from '../models/Settings.js';
import { resolveRequestedProfile, logProfileUsage } from '../services/aiProfileResolver.js';
import { generateVideoPlanText } from '../services/geminiService.js';
import { readProjectTextFile, writeProjectTextFile } from '../services/projectStorageGateway.js';
import { ensureDavinciLocalWorkspace } from '../services/davinciMediaStorage.js';
import { inspectAudioBlock, hasAudioDuration } from '../services/audioDuration.js';
import { readVoiceoverAudio } from '../services/voiceoverStorage.js';
import {
  DESCRIPTION_FILENAME, descriptionError, validateDescription, descriptionTimeline,
  descriptionSourceFingerprint, buildDescriptionPrompt, parseDescriptionResult,
} from '../services/youtubeDescriptionService.js';

const router = express.Router();
const publicTimeline = ({ chapters, ...rest }) => ({ ...rest, chapters: chapters.map(({ text, ...chapter }) => chapter) });
function fail(res, error) {
  const status = Number(error.status || error.response?.status);
  if (error.publicMessage) return res.status(status).json({ error: error.publicMessage });
  if (error.code === 'INVALID_AI_PROFILE') return res.status(400).json({ error: 'Выберите доступный текстовый профиль.' });
  console.error('[YOUTUBE_DESCRIPTION_FAILED]', { status: status || 500 });
  if (status === 429) return res.status(429).json({ error: 'Провайдер ограничил запросы. Проверьте квоту или выберите другой профиль.' });
  if (status === 503) return res.status(503).json({ error: 'Модель сейчас перегружена. Попробуйте позже или выберите другой профиль.' });
  return res.status(500).json({ error: 'Не удалось обработать описание YouTube. Попробуйте снова.' });
}
async function owned(req, res, next) {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw descriptionError(404, 'Проект не найден.');
    req.descriptionProject = await Project.findOne({ _id: req.params.id, userId: req.user._id }).select('+voiceover.blocks.audioStorageKey');
    if (!req.descriptionProject) throw descriptionError(404, 'Проект не найден.');
    next();
  } catch (error) { fail(res, error); }
}
const auth = [ensureAuthenticated, owned];
const fileArgs = (project, userId) => ({ project, userId, directory: '', filename: DESCRIPTION_FILENAME });

router.get('/:id/youtube-description', ...auth, async (req, res) => {
  try {
    const project = req.descriptionProject;
    const content = await readProjectTextFile(fileArgs(project, req.user._id));
    res.json({ success: true, content: content || '', filename: DESCRIPTION_FILENAME,
      projectTitle: project.shortTitle || project.title, hasScript: Boolean(project.script?.content?.trim()),
      timeline: publicTimeline(descriptionTimeline(project)), sourceFingerprint: descriptionSourceFingerprint(project) });
  } catch (error) { fail(res, error); }
});

router.post('/:id/youtube-description/generate', ...auth, async (req, res) => {
  try {
    const { instruction = '', content = '', profileId } = req.body || {};
    if (typeof instruction !== 'string' || instruction.length > 4000 || typeof content !== 'string' || content.length > 5000) {
      throw descriptionError(400, 'Инструкция — до 4000 символов, описание — до 5000.');
    }
    const project = req.descriptionProject;
    if (!project.script?.content?.trim()) throw descriptionError(400, 'Сначала создайте и сохраните сценарий проекта.');
    const settings = await Settings.findOne({ userId: req.user._id });
    const profile = resolveRequestedProfile(settings, 'text', profileId);
    // Backfill legacy audio metadata once, with the same probe as DaVinci export.
    for (const block of project.voiceover?.blocks || []) {
      if (block.audioStatus !== 'ready' || !block.audioStorageKey || hasAudioDuration(block.audioDurationSec)) continue;
      await inspectAudioBlock(block, {
        read: key => readVoiceoverAudio(key, project.projectPath, req.user._id),
        persist: async (source, durationSec) => {
          const result = await Project.updateOne({ _id: project._id, userId: req.user._id,
            'voiceover.blocks': { $elemMatch: { id: source.id, audioStorageKey: source.audioStorageKey,
              textRevision: source.textRevision, audioGeneratedAt: source.audioGeneratedAt } },
          }, { $set: { 'voiceover.blocks.$.audioDurationSec': durationSec } });
          if (!result.matchedCount) throw descriptionError(409, 'Озвучка изменилась. Повторите генерацию описания.');
        },
      });
    }
    const timeline = descriptionTimeline(project);
    const sourceFingerprint = descriptionSourceFingerprint(project);
    logProfileUsage('youtube-description', profile, 'text');
    const answer = await generateVideoPlanText(buildDescriptionPrompt({ project, timeline,
      systemPrompt: settings?.prompts?.youtubeDescription, instruction: instruction.trim(), content: content.trim() }), profile, true);
    const result = parseDescriptionResult(answer, timeline);
    const current = await Project.findOne({ _id: project._id, userId: req.user._id });
    if (!current || descriptionSourceFingerprint(current) !== sourceFingerprint) throw descriptionError(409, 'Сценарий или таймлайн изменился во время генерации. Повторите запрос.');
    res.json({ success: true, ...result, timeline: publicTimeline(timeline), sourceFingerprint });
  } catch (error) { fail(res, error); }
});

router.put('/:id/youtube-description', ...auth, async (req, res) => {
  try {
    const content = validateDescription(req.body?.content);
    const project = req.descriptionProject;
    await ensureDavinciLocalWorkspace(project, async root => {
      const result = await Project.updateOne({ _id: project._id, userId: req.user._id,
        'storage.provider': { $ne: 'google_drive' }, $or: [{ projectPath: '' }, { projectPath: null }],
      }, { $set: { projectPath: root } });
      if (!result.matchedCount) throw descriptionError(409, 'Папка проекта изменилась. Обновите страницу.');
    });
    await writeProjectTextFile({ ...fileArgs(project, req.user._id), content });
    res.json({ success: true, content, filename: DESCRIPTION_FILENAME });
  } catch (error) { fail(res, error); }
});

export default router;
