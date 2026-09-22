import JSZip from 'jszip';
import { videoInputFingerprint, normalizeVideoPlan } from './videoPlanService.js';
import { normalizeStoryboard, storyboardIsCurrent, storyboardImageMatchesFrame } from './storyboardService.js';
import { timelinePlan, TIMEBASE } from './davinciXmlService.js';
import { detectImageFormat } from './visualReferenceStorage.js';

export const MAX_FLOW_VIDEO_FRAMES = 100;
export const MAX_FLOW_VIDEO_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_FLOW_VIDEO_TOTAL_IMAGES_BYTES = 64 * 1024 * 1024;
export const MAX_FLOW_VIDEO_MANIFEST_BYTES = 1 * 1024 * 1024;

export const FLOW_VIDEO_PROVIDER = 'google-flow';
export const FLOW_VIDEO_PROFILE = 'google-flow';

const FRAME_ID_PATTERN = /^frame_[0-9a-fA-F-]{8,72}$/;
const SAFE_PATH_PATTERN = /^(images|prompts|video)\/video_frame_[0-9a-fA-F-]{8,72}__[0-9a-fA-F]{64}\.(png|jpg|jpeg|webp|txt|mp4)$/;

function errorWithCode(code, status = 400, message = code) {
  return Object.assign(new Error(message), { code, status });
}

export function flowVideoBaseName(frameId, inputFingerprint) {
  if (typeof frameId !== 'string' || !FRAME_ID_PATTERN.test(frameId)) {
    throw errorWithCode('INVALID_FRAME_ID', 400, 'Некорректный идентификатор кадра');
  }
  if (typeof inputFingerprint !== 'string' || !/^[0-9a-fA-F]{64}$/.test(inputFingerprint)) {
    throw errorWithCode('INVALID_INPUT_FINGERPRINT', 400, 'Некорректный отпечаток кадра');
  }
  return `video_${frameId}__${inputFingerprint.toLowerCase()}`;
}

export function buildFlowVideoManifest({ project, storyboardRevision, videoPlanRevision, frames, createdAt = new Date().toISOString() }) {
  return {
    schemaVersion: 1,
    kind: 'webapp-flow-video',
    projectId: String(project._id || project.id),
    storyboardRevision,
    videoPlanRevision,
    createdAt,
    frames: frames.map(f => ({
      frameId: f.frameId,
      blockNumber: f.blockNumber,
      frameInBlock: f.frameInBlock,
      inputFingerprint: f.inputFingerprint,
      expectedDurationSec: f.expectedDurationSec,
      durationExact: f.durationExact,
      imageFile: f.imageFile,
      promptFile: f.promptFile,
      outputFile: f.outputFile,
    })),
  };
}

export function flowVideoPromptsText(frames) {
  return frames.map((frame, index) => [
    `КАДР ${index + 1} (Блок ${frame.blockNumber}, кадр ${frame.frameInBlock})`,
    `frameId: ${frame.frameId}`,
    `inputFingerprint: ${frame.inputFingerprint}`,
    `Ожидаемая длительность: ${typeof frame.expectedDurationSec === 'number' ? frame.expectedDurationSec.toFixed(2) : 'не указана'}с (точно: ${frame.durationExact ? 'да' : 'нет'})`,
    `Исходное изображение: ${frame.imageFile}`,
    `Имя видео-результата: ${frame.outputFile}`,
    `Текст озвучки: ${frame.scriptText || ''}`,
    `PROMPT:\n${frame.videoPrompt || ''}`,
  ].join('\n')).join('\n\n========================================\n\n');
}

export function buildFlowVideoReadme() {
  return [
    'Google Flow Video Package',
    '=========================',
    '1. Сгенерируйте видео для каждого кадра по исходным изображениям и промтам.',
    '2. Имя выходного файла должно строго соответствовать outputFile из manifest.json:',
    '   video_<frameId>__<inputFingerprint>.mp4',
    '3. Готовые MP4 файлы импортируйте по отдельности в WebApp.',
  ].join('\n');
}

export function selectPendingFlowVideoFrames({ project, images = [], videos = [] }) {
  const storyboard = normalizeStoryboard(project);
  if (storyboard.status !== 'confirmed' || !storyboardIsCurrent(project, storyboard)) {
    throw errorWithCode('STORYBOARD_NOT_CONFIRMED', 409, 'Раскадровка должна быть актуальной и подтверждённой');
  }

  const videoPlan = normalizeVideoPlan(project);
  if (videoPlan.status !== 'confirmed') {
    throw errorWithCode('VIDEO_PLAN_NOT_CONFIRMED', 409, 'Видеоплан должен быть подтверждённым');
  }

  const frames = storyboard.frames || [];
  if (!frames.length) {
    throw errorWithCode('NO_PENDING_VIDEOS', 409, 'Нет кадров для экспорта');
  }

  const timings = new Map();
  try {
    const plan = timelinePlan(project.voiceover?.blocks || [], frames);
    for (const item of plan.blocks) {
      item.frames.forEach((frame, index) => timings.set(frame.id, {
        blockNumber: item.block.order,
        frameInBlock: index + 1,
        targetDurationSec: item.durations[index] / TIMEBASE,
        durationExact: item.exact,
      }));
    }
  } catch (error) {
    throw errorWithCode(error?.code || 'VIDEO_TIMING_UNAVAILABLE', 409, 'Не удалось рассчитать тайминг видео');
  }

  const imageById = new Map(images.map(img => [img.frameId, img]));
  const videoById = new Map(videos.map(v => [v.frameId, v?.toObject ? v.toObject() : v]));

  const selectedFrameIds = [];
  const selectedFrames = [];

  for (const planFrame of videoPlan.frames) {
    if (!planFrame.selected) continue;
    selectedFrameIds.push(planFrame.frameId);

    const frame = frames.find(f => f.id === planFrame.frameId);
    if (!frame || !FRAME_ID_PATTERN.test(frame.id)) {
      throw errorWithCode('UNKNOWN_FRAME_ID', 400, `Кадр ${planFrame.frameId} не найден в раскадровке`);
    }

    const videoPrompt = (planFrame.videoPrompt || '').trim();
    if (!videoPrompt || planFrame.promptStatus !== 'ready') {
      throw errorWithCode('PLAN_NOT_READY', 400, `У выбранного кадра ${frame.id} не подготовлен промт видео`);
    }

    const sourceImage = imageById.get(frame.id);
    const hasImage = sourceImage?.status === 'ready' &&
      Boolean(sourceImage.storageKey) &&
      storyboardImageMatchesFrame(sourceImage, frame);

    if (!hasImage) {
      throw errorWithCode('IMAGE_MISSING', 409, `У выбранного кадра ${frame.id} отсутствует актуальное изображение`);
    }

    const timing = timings.get(frame.id);
    if (!timing || !Number.isFinite(timing.targetDurationSec) || timing.targetDurationSec <= 0) {
      throw errorWithCode('VIDEO_TIMING_UNAVAILABLE', 409, `Не удалось определить длительность для кадра ${frame.id}`);
    }

    const fingerprint = videoInputFingerprint({
      frame,
      planFrame,
      image: sourceImage,
      durationSec: timing.targetDurationSec,
      generationProfileId: FLOW_VIDEO_PROFILE,
      provider: FLOW_VIDEO_PROVIDER,
    });

    const existingVideo = videoById.get(frame.id);
    const isReady = existingVideo &&
      existingVideo.status === 'ready' &&
      existingVideo.inputFingerprint === fingerprint;

    if (!isReady) {
      selectedFrames.push({
        frameId: frame.id,
        blockNumber: timing.blockNumber,
        frameInBlock: timing.frameInBlock,
        scriptText: frame.scriptText,
        videoPrompt,
        inputFingerprint: fingerprint,
        expectedDurationSec: timing.targetDurationSec,
        durationExact: timing.durationExact,
        sourceImage,
      });
    }
  }

  if (selectedFrames.length === 0) {
    throw errorWithCode('NO_PENDING_VIDEOS', 409, 'Все выбранные видео уже актуальны');
  }

  if (selectedFrames.length > MAX_FLOW_VIDEO_FRAMES) {
    throw errorWithCode('VIDEO_EXPORT_TOO_LARGE', 413, `Превышен лимит кадров для экспорта (максимум ${MAX_FLOW_VIDEO_FRAMES})`);
  }

  return {
    storyboardRevision: storyboard.revision,
    videoPlanRevision: videoPlan.revision,
    editVersion: project.videoPlan?.editVersion ?? project.editVersion,
    selectedFrameIds,
    frames: selectedFrames,
  };
}

export function verifyFlowVideoExportSnapshot({
  project,
  images = [],
  expectedFrames = [],
  expectedStoryboardRevision,
  expectedVideoPlanRevision,
  expectedEditVersion,
  expectedSelectedFrameIds,
}) {
  const storyboard = normalizeStoryboard(project);
  if (storyboard.status !== 'confirmed' || !storyboardIsCurrent(project, storyboard)) {
    throw errorWithCode('FRAME_CHANGED', 409, 'Раскадровка изменилась во время подготовки пакета');
  }

  if (expectedStoryboardRevision !== undefined && storyboard.revision !== expectedStoryboardRevision) {
    throw errorWithCode('FRAME_CHANGED', 409, 'Ревизия раскадровки изменилась во время подготовки пакета');
  }

  const videoPlan = normalizeVideoPlan(project);
  if (videoPlan.status !== 'confirmed') {
    throw errorWithCode('VIDEO_PLAN_CONFLICT', 409, 'Видеоплан изменился во время подготовки пакета');
  }

  if (expectedVideoPlanRevision !== undefined && videoPlan.revision !== expectedVideoPlanRevision) {
    throw errorWithCode('VIDEO_PLAN_CONFLICT', 409, 'Ревизия видеоплана изменилась во время подготовки пакета');
  }

  const currentEditVersion = project.videoPlan?.editVersion ?? project.editVersion;
  if (expectedEditVersion !== undefined && currentEditVersion !== expectedEditVersion) {
    throw errorWithCode('VIDEO_PLAN_CONFLICT', 409, 'Версия редактирования видеоплана изменилась во время подготовки пакета');
  }

  const currentSelectedFrameIds = (videoPlan.frames || []).filter(f => f.selected).map(f => f.frameId);
  if (expectedSelectedFrameIds) {
    const expectedSet = new Set(expectedSelectedFrameIds);
    const currentSet = new Set(currentSelectedFrameIds);
    if (expectedSet.size !== currentSet.size || !expectedSelectedFrameIds.every(id => currentSet.has(id))) {
      throw errorWithCode('VIDEO_PLAN_CONFLICT', 409, 'Состав выбранных кадров изменился во время подготовки пакета');
    }
  }

  const timings = new Map();
  try {
    const plan = timelinePlan(project.voiceover?.blocks || [], storyboard.frames || []);
    for (const item of plan.blocks) {
      item.frames.forEach((frame, index) => timings.set(frame.id, {
        targetDurationSec: item.durations[index] / TIMEBASE,
      }));
    }
  } catch {
    throw errorWithCode('FRAME_CHANGED', 409, 'Тайминги проекта изменились во время подготовки пакета');
  }

  const imageById = new Map(images.map(img => [img.frameId, img]));
  const planFramesById = new Map(videoPlan.frames.map(f => [f.frameId, f]));
  const storyboardFramesById = new Map((storyboard.frames || []).map(f => [f.id, f]));

  for (const expected of expectedFrames) {
    const frame = storyboardFramesById.get(expected.frameId);
    const planFrame = planFramesById.get(expected.frameId);
    const image = imageById.get(expected.frameId);
    const timing = timings.get(expected.frameId);

    if (!frame || !planFrame || !image || !timing || !planFrame.selected) {
      throw errorWithCode('FRAME_CHANGED', 409, 'Состав кадров изменился во время подготовки пакета');
    }

    if (!storyboardImageMatchesFrame(image, frame) || image.status !== 'ready') {
      throw errorWithCode('IMAGE_MISSING', 409, 'Изображение кадра изменилось во время подготовки пакета');
    }

    const currentFingerprint = videoInputFingerprint({
      frame,
      planFrame,
      image,
      durationSec: timing.targetDurationSec,
      generationProfileId: FLOW_VIDEO_PROFILE,
      provider: FLOW_VIDEO_PROVIDER,
    });

    if (currentFingerprint !== expected.inputFingerprint) {
      throw errorWithCode('FRAME_CHANGED', 409, 'Исходные данные кадра изменились во время подготовки пакета');
    }
  }
}

export async function createFlowVideoExportPackage({ project, images = [], videos = [], readImageFile }) {
  const { storyboardRevision, videoPlanRevision, editVersion, selectedFrameIds, frames } = selectPendingFlowVideoFrames({ project, images, videos });

  let totalImagesBytes = 0;
  const processedFrames = [];
  const imageBuffers = [];

  for (const frame of frames) {
    const buffer = await readImageFile(frame.sourceImage.storageKey);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw errorWithCode('IMAGE_MISSING', 409, `Не удалось прочитать изображение кадра ${frame.frameId}`);
    }

    if (buffer.length > MAX_FLOW_VIDEO_IMAGE_BYTES) {
      throw errorWithCode('VIDEO_EXPORT_TOO_LARGE', 413, `Изображение кадра ${frame.frameId} превышает 15 МБ`);
    }

    totalImagesBytes += buffer.length;
    if (totalImagesBytes > MAX_FLOW_VIDEO_TOTAL_IMAGES_BYTES) {
      throw errorWithCode('VIDEO_EXPORT_TOO_LARGE', 413, 'Суммарный объём изображений пакета превышает 64 МБ');
    }

    const format = detectImageFormat(buffer);
    const baseName = flowVideoBaseName(frame.frameId, frame.inputFingerprint);
    const imageFile = `images/${baseName}.${format.extension}`;
    const promptFile = `prompts/${baseName}.txt`;
    const outputFile = `video/${baseName}.mp4`;

    if (!SAFE_PATH_PATTERN.test(imageFile) || !SAFE_PATH_PATTERN.test(promptFile) || !SAFE_PATH_PATTERN.test(outputFile)) {
      throw errorWithCode('INVALID_VIDEO_FILENAME', 400, 'Небезопасный путь файла в пакете');
    }

    processedFrames.push({
      ...frame,
      baseName,
      imageFile,
      promptFile,
      outputFile,
    });

    imageBuffers.push({
      filePath: imageFile,
      buffer,
    });
  }

  const manifest = buildFlowVideoManifest({
    project,
    storyboardRevision,
    videoPlanRevision,
    frames: processedFrames,
  });

  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestBytes = Buffer.byteLength(manifestJson, 'utf8');
  if (manifestBytes > MAX_FLOW_VIDEO_MANIFEST_BYTES) {
    throw errorWithCode('VIDEO_EXPORT_TOO_LARGE', 413, 'Размер manifest.json превышает 1 МБ');
  }

  const archive = new JSZip();
  archive.file('manifest.json', manifestJson);
  archive.file('prompts.txt', flowVideoPromptsText(processedFrames));
  archive.file('README.txt', buildFlowVideoReadme());

  for (const frame of processedFrames) {
    archive.file(frame.promptFile, frame.videoPrompt);
  }

  for (const item of imageBuffers) {
    archive.file(item.filePath, item.buffer);
  }

  const zipBuffer = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });

  return {
    zipBuffer,
    manifest,
    frames: processedFrames,
    frameCount: processedFrames.length,
    filename: `flow-video-r${videoPlanRevision}.zip`,
    storyboardRevision,
    videoPlanRevision,
    editVersion,
    selectedFrameIds,
  };
}
