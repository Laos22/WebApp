import express from 'express';
import Project from '../models/Project.js';
import ShortVideo from '../models/ShortVideo.js';
import StoryboardImage from '../models/StoryboardImage.js';
import StoryboardVideo from '../models/StoryboardVideo.js';
import Settings from '../models/Settings.js';
import { ensureAuthenticated } from '../middleware/auth.js';
import { normalizeStoryboard, storyboardImageMatchesFrame, storyboardIsCurrent } from '../services/storyboardService.js';
import { shortResponse, validateShortDraft, shortSuggestionPrompt, parseShortSuggestions } from '../services/shortsService.js';
import { resolveRequestedProfile } from '../services/aiProfileResolver.js';
import { generateVideoPlanText } from '../services/geminiService.js';
import { synthesizeElevenLabs } from '../services/elevenLabsService.js';
import { measureMp3Duration } from '../services/audioDuration.js';
import { saveShortAudio, readShortAudio, deleteShortAudio } from '../services/shortsStorage.js';
import { createDavinciXml, imageExtension } from '../services/davinciXmlService.js';
import { saveDavinciStill, prepareDavinciImages, davinciDriveStillFilename, ensureDavinciLocalWorkspace } from '../services/davinciMediaStorage.js';
import { readStoryboardImageFile } from '../services/storyboardImageStorage.js';
import { readStoryboardVideoFile } from '../services/storyboardVideoStorage.js';
import { ensurePortableLocalFile } from '../services/davinciMediaStorage.js';
import { videoPlanResponse } from '../services/videoPlanService.js';
import { checkDriveFile, copyDriveImagesForDavinci } from '../services/driveSync.js';
import { projectUsesDrive, writeProjectTextFile } from '../services/projectStorageGateway.js';
import { readMusicFile } from '../services/musicStorage.js';
import { normalizeMediaRoot } from '../../../shared/davinciMediaPaths.js';
import { DEFAULT_BACKGROUND_MUSIC_VOLUME, validBackgroundMusicVolume } from '../../../shared/davinciMusicVolume.js';

const router = express.Router();
const shortIdPattern = /^[a-f0-9]{24}$/;
const owner = req => ({ _id: req.params.id, userId: req.user._id });
const shortOwner = req => ({ _id: req.params.shortId, projectId: req.params.id, userId: req.user._id });
function validShortId(req, res) {
  if (shortIdPattern.test(req.params.shortId)) return true;
  res.status(400).json({ error: 'Некорректный шортс' });
  return false;
}

async function projectForShorts(req, res) {
  const project = await Project.findOne(owner(req)).select('+backgroundMusic.storageKey');
  if (!project) res.status(404).json({ error: 'Проект не найден' });
  return project;
}

function confirmedStoryboard(project) {
  const storyboard = normalizeStoryboard(project);
  return storyboard.status === 'confirmed' && storyboardIsCurrent(project, storyboard) ? storyboard : null;
}

router.get('/:id/shorts', ensureAuthenticated, async (req, res) => {
  try {
    const project = await projectForShorts(req, res);
    if (!project) return;
    const shorts = await ShortVideo.find({ projectId: project._id, userId: req.user._id }).sort({ createdAt: -1 });
    return res.json({ success: true, storyboardRevision: project.storyboard?.revision || 0,
      shorts: shorts.map(shortResponse) });
  } catch { return res.status(500).json({ error: 'Не удалось загрузить шортсы' }); }
});

router.post('/:id/shorts/suggest', ensureAuthenticated, async (req, res) => {
  try {
    if (Object.keys(req.body || {}).some(key => key !== 'profileId')) return res.status(400).json({ error: 'Некорректные параметры анализа' });
    const project = await projectForShorts(req, res);
    if (!project) return;
    const storyboard = confirmedStoryboard(project);
    if (!storyboard?.frames.length) return res.status(409).json({ error: 'Сначала утвердите актуальную раскадровку' });
    const images = await StoryboardImage.find({ projectId: project._id, userId: req.user._id,
      frameId: { $in: storyboard.frames.map(frame => frame.id) }, status: 'ready' }).select('+storageKey');
    const imageByFrame = new Map(images.map(image => [image.frameId, image]));
    const availableFrames = storyboard.frames.filter(frame => {
      const image = imageByFrame.get(frame.id);
      return image?.storageKey && storyboardImageMatchesFrame(image, frame);
    });
    if (!availableFrames.length) return res.status(409).json({ error: 'Сначала подготовьте изображения кадров' });
    const settings = await Settings.findOne({ userId: req.user._id });
    const profile = resolveRequestedProfile(settings, 'text', req.body?.profileId);
    const raw = await generateVideoPlanText(shortSuggestionPrompt(project, availableFrames), profile, true,
      'Верни только JSON с массивом suggestions. Каждый вариант: title, hook, narration, frameOrders. Номера кадров должны существовать. Шортс 30–60 секунд, 6–12 кадров, самостоятельная история.');
    const suggestions = parseShortSuggestions(raw, availableFrames);
    if (!suggestions) return res.status(502).json({ error: 'ИИ вернул некорректные идеи шортсов. Повторите анализ.' });
    return res.json({ success: true, suggestions });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    return res.status(502).json({ error: 'Не удалось подготовить идеи шортсов' });
  }
});

router.post('/:id/shorts', ensureAuthenticated, async (req, res) => {
  try {
    const project = await projectForShorts(req, res);
    if (!project) return;
    const storyboard = confirmedStoryboard(project);
    if (!storyboard) return res.status(409).json({ error: 'Сначала утвердите актуальную раскадровку' });
    const draft = validateShortDraft(req.body, new Set(storyboard.frames.map(frame => frame.id)));
    if (!draft) return res.status(400).json({ error: 'Проверьте название, текст и выбранные кадры' });
    if (await ShortVideo.countDocuments({ projectId: project._id, userId: req.user._id }) >= 20) {
      return res.status(409).json({ error: 'В проекте уже 20 шортсов. Удалите ненужный вариант.' });
    }
    const created = await ShortVideo.create({ ...draft, projectId: project._id, userId: req.user._id,
      sourceStoryboardRevision: storyboard.revision });
    return res.status(201).json({ success: true, short: shortResponse(created) });
  } catch { return res.status(500).json({ error: 'Не удалось создать шортс' }); }
});

router.patch('/:id/shorts/:shortId', ensureAuthenticated, async (req, res) => {
  if (!validShortId(req, res)) return;
  try {
    const project = await projectForShorts(req, res);
    if (!project) return;
    const storyboard = confirmedStoryboard(project);
    if (!storyboard) return res.status(409).json({ error: 'Раскадровка проекта требует обновления' });
    const current = await ShortVideo.findOne(shortOwner(req));
    if (!current) return res.status(404).json({ error: 'Шортс не найден' });
    if (!Number.isSafeInteger(req.body?.version) || req.body.version !== current.version) return res.status(409).json({ error: 'Шортс изменился. Обновите страницу.' });
    const { version, ...body } = req.body;
    const draft = validateShortDraft(body, new Set(storyboard.frames.map(frame => frame.id)));
    if (!draft) return res.status(400).json({ error: 'Проверьте название, текст и выбранные кадры' });
    const narrationChanged = draft.narration !== current.narration;
    const saved = await ShortVideo.findOneAndUpdate({ ...shortOwner(req), version }, {
      $set: { ...draft, sourceStoryboardRevision: storyboard.revision,
        ...(narrationChanged ? { 'audio.status': 'stale' } : {}) },
      $inc: { version: 1, ...(narrationChanged ? { narrationRevision: 1 } : {}) },
    }, { new: true, runValidators: true });
    if (!saved) return res.status(409).json({ error: 'Шортс изменился. Обновите страницу.' });
    return res.json({ success: true, short: shortResponse(saved) });
  } catch { return res.status(500).json({ error: 'Не удалось сохранить шортс' }); }
});

router.delete('/:id/shorts/:shortId', ensureAuthenticated, async (req, res) => {
  if (!validShortId(req, res)) return;
  try {
    const project = await projectForShorts(req, res);
    if (!project) return;
    const removed = await ShortVideo.findOneAndDelete(shortOwner(req)).select('+audio.storageKey');
    if (!removed) return res.status(404).json({ error: 'Шортс не найден' });
    if (removed.audio?.storageKey) await deleteShortAudio({ project, userId: req.user._id,
      storageKey: removed.audio.storageKey, filename: removed.audio.filename }).catch(() => {});
    return res.json({ success: true });
  } catch { return res.status(500).json({ error: 'Не удалось удалить шортс' }); }
});

router.post('/:id/shorts/:shortId/audio', ensureAuthenticated, async (req, res) => {
  if (!validShortId(req, res)) return;
  let stored;
  let project;
  try {
    if (Object.keys(req.body || {}).some(key => key !== 'profileId')) return res.status(400).json({ error: 'Некорректный профиль' });
    project = await projectForShorts(req, res);
    if (!project) return;
    const short = await ShortVideo.findOne(shortOwner(req)).select('+audio.storageKey');
    if (!short) return res.status(404).json({ error: 'Шортс не найден' });
    const settings = await Settings.findOne({ userId: req.user._id });
    const profile = resolveRequestedProfile(settings, 'audio', req.body?.profileId);
    if (!profile || profile.provider !== 'elevenlabs') return res.status(409).json({ error: 'Нужен профиль озвучки ElevenLabs' });
    const buffer = await synthesizeElevenLabs(short.narration, profile);
    const durationSec = await measureMp3Duration(buffer);
    if (durationSec < 5 || durationSec > 180) return res.status(409).json({ error: 'Озвучка должна длиться от 5 секунд до 3 минут' });
    await ensureDavinciLocalWorkspace(project, async root => {
      const result = await Project.updateOne({ ...owner(req), 'storage.provider': { $ne: 'google_drive' },
        $or: [{ projectPath: '' }, { projectPath: null }] }, { $set: { projectPath: root } });
      if (!result.matchedCount) throw new Error('SHORT_PROJECT_CHANGED');
    });
    stored = await saveShortAudio({ project, userId: req.user._id, shortId: req.params.shortId, buffer });
    const saved = await ShortVideo.findOneAndUpdate({ ...shortOwner(req), version: short.version,
      narrationRevision: short.narrationRevision }, { $set: { audio: { status: 'ready', ...stored,
      durationSec, textRevision: short.narrationRevision, generatedAt: new Date() } }, $inc: { version: 1 } },
    { new: true, runValidators: true });
    if (!saved) {
      await deleteShortAudio({ project, userId: req.user._id, ...stored }).catch(() => {});
      return res.status(409).json({ error: 'Текст шортса изменился во время озвучки. Повторите запрос.' });
    }
    if (short.audio?.storageKey) await deleteShortAudio({ project, userId: req.user._id,
      storageKey: short.audio.storageKey, filename: short.audio.filename }).catch(() => {});
    return res.json({ success: true, short: shortResponse(saved) });
  } catch (error) {
    if (stored && project) await deleteShortAudio({ project, userId: req.user._id, ...stored }).catch(() => {});
    return res.status(error.httpStatus || error.status || 500).json({ error: error.publicMessage || 'Не удалось создать озвучку шортса' });
  }
});

router.get('/:id/shorts/:shortId/audio', ensureAuthenticated, async (req, res) => {
  if (!validShortId(req, res)) return;
  try {
    const project = await projectForShorts(req, res);
    if (!project) return;
    const short = await ShortVideo.findOne(shortOwner(req)).select('+audio.storageKey');
    if (!short?.audio?.storageKey || short.audio.status !== 'ready' ||
        short.audio.textRevision !== short.narrationRevision) return res.status(404).json({ error: 'Озвучка не готова' });
    const buffer = await readShortAudio({ project, userId: req.user._id,
      storageKey: short.audio.storageKey, filename: short.audio.filename });
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', String(buffer.length));
    return res.send(buffer);
  } catch { return res.status(500).json({ error: 'Не удалось прочитать озвучку' }); }
});

router.post('/:id/shorts/:shortId/export', ensureAuthenticated, async (req, res) => {
  if (!validShortId(req, res)) return;
  let stage = 'settings';
  try {
    const { mediaRootPath = '', pathMode = 'absolute', includeMusic = true,
      backgroundMusicVolume = DEFAULT_BACKGROUND_MUSIC_VOLUME, frameRate = 24 } = req.body || {};
    if (Object.keys(req.body || {}).some(key => !['mediaRootPath', 'pathMode', 'includeMusic', 'backgroundMusicVolume', 'frameRate'].includes(key)) ||
        !['absolute', 'relative'].includes(pathMode) || typeof mediaRootPath !== 'string' ||
        typeof includeMusic !== 'boolean' || !validBackgroundMusicVolume(backgroundMusicVolume) ||
        ![24, 25, 30].includes(frameRate)) return res.status(400).json({ error: 'Некорректные настройки XML' });
    const project = await projectForShorts(req, res);
    if (!project) return;
    if (pathMode === 'absolute' && !mediaRootPath.trim() && (projectUsesDrive(project) || process.env.NODE_ENV === 'production')) {
      return res.status(400).json({ error: 'Укажите локальную папку проекта на компьютере с DaVinci Resolve' });
    }
    const resolvedMediaRoot = pathMode === 'relative' ? '' : normalizeMediaRoot(mediaRootPath.trim() || project.projectPath);
    const short = await ShortVideo.findOne(shortOwner(req)).select('+audio.storageKey');
    if (!short) return res.status(404).json({ error: 'Шортс не найден' });
    if (short.audio?.status !== 'ready' || short.audio.textRevision !== short.narrationRevision ||
        !short.audio.storageKey || !short.audio.durationSec) return res.status(409).json({ error: 'Сначала создайте озвучку актуального текста шортса' });
    const storyboard = confirmedStoryboard(project);
    if (!storyboard) return res.status(409).json({ error: 'Раскадровка проекта требует обновления' });
    const frameById = new Map(storyboard.frames.map(frame => [frame.id, frame]));
    if (short.shots.some(shot => !frameById.has(shot.frameId))) return res.status(409).json({ error: 'Некоторые кадры шортса удалены из раскадровки' });
    const sourceFrames = short.shots.map(shot => frameById.get(shot.frameId));
    const images = await StoryboardImage.find({ projectId: project._id, userId: req.user._id,
      frameId: { $in: short.shots.map(shot => shot.frameId) } }).select('+storageKey');
    const imageByFrame = new Map(images.map(image => [image.frameId, image]));
    if (sourceFrames.some(frame => { const image = imageByFrame.get(frame.id);
      return image?.status !== 'ready' || !image.storageKey || !storyboardImageMatchesFrame(image, frame); })) {
      return res.status(409).json({ error: 'У одного из выбранных кадров нет актуального изображения' });
    }
    stage = 'audio';
    await readShortAudio({ project, userId: req.user._id, storageKey: short.audio.storageKey,
      filename: short.audio.filename });
    await ensureDavinciLocalWorkspace(project, async root => {
      const result = await Project.updateOne({ ...owner(req), 'storage.provider': { $ne: 'google_drive' },
        $or: [{ projectPath: '' }, { projectPath: null }] }, { $set: { projectPath: root } });
      if (!result.matchedCount) throw new Error('SHORT_PROJECT_CHANGED');
    });
    stage = 'images';
    const remoteImages = projectUsesDrive(project) ? sourceFrames.flatMap(frame => {
      const image = imageByFrame.get(frame.id);
      return /^gdrive:[A-Za-z0-9_-]+$/.test(image.storageKey)
        ? [{ frameId: frame.id, storageKey: image.storageKey, mimeType: image.mimeType }] : [];
    }) : [];
    const remoteStills = remoteImages.length ? await copyDriveImagesForDavinci({ userId: req.user._id,
      parentId: project.storage.driveFolderIds.images, images: remoteImages,
      filenameFor: davinciDriveStillFilename }) : new Map();
    const imageFiles = await prepareDavinciImages(sourceFrames, async frame => {
      if (remoteStills.has(frame.id)) return remoteStills.get(frame.id);
      const image = imageByFrame.get(frame.id);
      const buffer = await readStoryboardImageFile(image.storageKey, project.projectPath, req.user._id);
      return saveDavinciStill({ project, userId: req.user._id, buffer,
        extension: imageExtension(image.mimeType), mimeType: image.mimeType });
    });
    stage = 'video';
    const videos = await StoryboardVideo.find({ projectId: project._id, userId: req.user._id,
      frameId: { $in: short.shots.map(shot => shot.frameId) }, status: 'ready' }).select('+storageKey');
    const videoState = videoPlanResponse(project, images, videos);
    const videoByFrame = new Map(videos.map(video => [video.frameId, video]));
    const videoFiles = new Map();
    for (const frame of videoState.frames) {
      if (!short.shots.some(shot => shot.frameId === frame.frameId) || frame.video?.status !== 'ready') continue;
      const video = videoByFrame.get(frame.frameId);
      if (!video?.storageKey || !video.filename) continue;
      if (projectUsesDrive(project)) await checkDriveFile({ userId: req.user._id, storageKey: video.storageKey });
      else {
        const buffer = await readStoryboardVideoFile(video.storageKey, project.projectPath, req.user._id);
        await ensurePortableLocalFile(project.projectPath, 'video', video.filename, buffer);
      }
      videoFiles.set(frame.frameId, { filename: video.filename, durationSec: video.durationSec,
        width: video.width, height: video.height });
    }
    stage = 'music';
    let backgroundMusic = null;
    if (includeMusic && project.backgroundMusic?.status === 'ready' && project.backgroundMusic.storageKey) {
      const buffer = await readMusicFile(project.backgroundMusic.storageKey, project, req.user._id);
      const durationSec = await measureMp3Duration(buffer);
      backgroundMusic = { filename: project.backgroundMusic.filename, durationSec,
        title: project.backgroundMusic.title, loop: true };
      if (!projectUsesDrive(project) && project.backgroundMusic.storageKey !== `project/audio/${backgroundMusic.filename}`) {
        await ensurePortableLocalFile(project.projectPath, 'audio', backgroundMusic.filename, buffer);
      }
    }
    stage = 'xml';
    const frames = short.shots.map(shot => {
      const source = frameById.get(shot.frameId);
      return { ...(source.toObject ? source.toObject() : source),
        sourceVoiceoverBlockId: 'short', durationWeight: shot.durationWeight };
    });
    const xml = createDavinciXml({ projectName: short.title, frames,
      voiceoverBlocks: [{ id: 'short', order: 1, adaptedText: short.narration,
        audioDurationSec: short.audio.durationSec, audioFilename: short.audio.filename }],
      imageFiles, videoFiles, frameRate, outputWidth: 1080, outputHeight: 1920,
      horizontalOffsets: new Map(short.shots.map(shot => [shot.frameId, shot.horizontalOffset])),
      addAnimations: true, mediaRootPath: resolvedMediaRoot, backgroundMusic,
      backgroundMusicVolume });
    const filename = `Short_${String(short._id)}.fcpxml`;
    await writeProjectTextFile({ project, userId: req.user._id, directory: '', filename,
      content: xml, mimeType: 'application/xml' });
    return res.json({ success: true, filename, mediaRootPath: resolvedMediaRoot,
      durationSec: short.audio.durationSec, videosUsed: videoFiles.size });
  } catch (error) {
    if (error.code === 'INVALID_DAVINCI_MEDIA_ROOT') return res.status(400).json({ error: 'Укажите абсолютный путь к папке проекта на компьютере с Resolve' });
    console.error('[Short export]', { stage, code: error.code || 'SHORT_EXPORT_FAILED' });
    return res.status(500).json({ error: `Не удалось экспортировать шортс. Этап: ${stage}.` });
  }
});

export default router;
