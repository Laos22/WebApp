import Project from '../models/Project.js';
import StoryboardVideo from '../models/StoryboardVideo.js';
import StoryboardImage from '../models/StoryboardImage.js';
import { normalizeVideoPlan, videoInputFingerprint } from './videoPlanService.js';
import { normalizeStoryboard, storyboardIsCurrent, storyboardImageMatchesFrame } from './storyboardService.js';
import { timelinePlan, TIMEBASE } from './davinciXmlService.js';
import { validateUploadedFilename, validateMp4Buffer } from './flowVideoValidation.js';
import { saveStoryboardVideoFile, deleteStoryboardVideoFile } from './storyboardVideoStorage.js';
import { FLOW_VIDEO_PROVIDER, FLOW_VIDEO_PROFILE } from './flowVideoPackageService.js';

function errorWithCode(code, status = 400, message = code) {
  return Object.assign(new Error(message), { code, status });
}

function verifyFrameState(project, frameId, sourceImage) {
  const storyboard = normalizeStoryboard(project);
  if (storyboard.status !== 'confirmed' || !storyboardIsCurrent(project, storyboard)) {
    throw errorWithCode('STORYBOARD_NOT_CONFIRMED', 409, 'Раскадровка должна быть актуальной и подтверждённой');
  }

  const videoPlan = normalizeVideoPlan(project);
  if (videoPlan.status !== 'confirmed') {
    throw errorWithCode('VIDEO_PLAN_NOT_CONFIRMED', 409, 'Видеоплан должен быть подтверждённым');
  }

  const frames = storyboard.frames || [];
  const frame = frames.find(f => f.id === frameId);
  if (!frame) {
    throw errorWithCode('FRAME_NOT_FOUND', 404, 'Кадр не найден в проекте');
  }

  const planFrame = videoPlan.frames.find(f => f.frameId === frameId);
  if (!planFrame || !planFrame.selected) {
    throw errorWithCode('FRAME_NOT_SELECTED', 400, 'Кадр не выбран в видеоплане для генерации видео');
  }

  const videoPrompt = (planFrame.videoPrompt || '').trim();
  if (!videoPrompt || planFrame.promptStatus !== 'ready') {
    throw errorWithCode('PLAN_NOT_READY', 400, 'У выбранного кадра не подготовлен промт видео');
  }

  const hasImage = sourceImage &&
    sourceImage.status === 'ready' &&
    Boolean(sourceImage.storageKey) &&
    storyboardImageMatchesFrame(sourceImage, frame);

  if (!hasImage) {
    throw errorWithCode('IMAGE_MISSING', 409, 'У кадра отсутствует актуальное подтверждённое изображение');
  }

  let timing = null;
  try {
    const plan = timelinePlan(project.voiceover?.blocks || [], frames);
    for (const item of plan.blocks) {
      const idx = item.frames.findIndex(f => f.id === frameId);
      if (idx >= 0) {
        timing = {
          blockNumber: item.block.order,
          frameInBlock: idx + 1,
          targetDurationSec: item.durations[idx] / TIMEBASE,
          durationExact: item.exact,
        };
        break;
      }
    }
  } catch (err) {
    throw errorWithCode(err?.code || 'VIDEO_TIMING_UNAVAILABLE', 409, 'Не удалось рассчитать тайминг кадра');
  }

  if (!timing || !Number.isFinite(timing.targetDurationSec) || timing.targetDurationSec <= 0) {
    throw errorWithCode('VIDEO_TIMING_UNAVAILABLE', 409, 'Не удалось определить длительность для кадра');
  }

  const expectedFingerprint = videoInputFingerprint({
    frame,
    planFrame,
    image: sourceImage,
    durationSec: timing.targetDurationSec,
    generationProfileId: FLOW_VIDEO_PROFILE,
    provider: FLOW_VIDEO_PROVIDER,
  });

  return { frame, planFrame, timing, expectedFingerprint };
}

export async function importFlowVideoSingleFrame({
  project,
  userId,
  frameId,
  inputFingerprint,
  fileBuffer,
  uploadedFilename,
}) {
  if (typeof frameId !== 'string' || !frameId) {
    throw errorWithCode('INVALID_FRAME_ID', 400, 'Некорректный идентификатор кадра');
  }

  if (typeof inputFingerprint !== 'string' || !/^[0-9a-fA-F]{64}$/.test(inputFingerprint)) {
    throw errorWithCode('INVALID_INPUT_FINGERPRINT', 400, 'Некорректный отпечаток кадра (inputFingerprint)');
  }

  // 1. Validate uploaded filename
  validateUploadedFilename(uploadedFilename, frameId, inputFingerprint);

  // 2. Validate MP4 buffer structure
  const mp4Meta = validateMp4Buffer(fileBuffer);

  // 3. Initial project verification
  const initialImage = await StoryboardImage.findOne({
    projectId: project._id,
    userId,
    frameId,
  }).select('+storageKey');

  const initialVerification = verifyFrameState(project, frameId, initialImage);
  if (inputFingerprint.toLowerCase() !== initialVerification.expectedFingerprint.toLowerCase()) {
    throw errorWithCode('STALE_INPUT_FINGERPRINT', 409, 'Исходные данные кадра изменились. Сгенерируйте видео заново.');
  }

  // 4. Save new video file under a unique storage key
  const stored = await saveStoryboardVideoFile({
    project,
    userId,
    frameId,
    buffer: fileBuffer,
    unique: true,
  });

  let dbCommitted = false;
  let outcome = 'imported';
  let savedVideo = null;
  let oldStorageKeyToDelete = null;

  try {
    // 5. Re-read Project and Image to guard against concurrent changes
    const freshProject = await Project.findOne({ _id: project._id, userId });
    if (!freshProject) {
      throw errorWithCode('PROJECT_NOT_FOUND', 404, 'Проект не найден');
    }

    const freshImage = await StoryboardImage.findOne({
      projectId: project._id,
      userId,
      frameId,
    }).select('+storageKey');

    const freshVerification = verifyFrameState(freshProject, frameId, freshImage);
    if (inputFingerprint.toLowerCase() !== freshVerification.expectedFingerprint.toLowerCase()) {
      throw errorWithCode('STALE_INPUT_FINGERPRINT', 409, 'Исходные данные кадра изменились во время сохранения видео.');
    }

    // 6. Check existing StoryboardVideo record for CAS
    const previous = await StoryboardVideo.findOne({
      userId,
      projectId: project._id,
      frameId,
    }).select('+storageKey');

    if (previous) {
      const updated = await StoryboardVideo.findOneAndUpdate(
        {
          _id: previous._id,
          userId,
          projectId: project._id,
          frameId,
          updatedAt: previous.updatedAt,
          storageKey: previous.storageKey,
        },
        {
          $set: {
            status: 'ready',
            storageKey: stored.storageKey,
            mimeType: 'video/mp4',
            filename: stored.filename,
            byteSize: stored.byteSize,
            durationSec: mp4Meta.durationSec,
            width: mp4Meta.width,
            height: mp4Meta.height,
            generationProfileId: FLOW_VIDEO_PROFILE,
            provider: FLOW_VIDEO_PROVIDER,
            inputFingerprint: freshVerification.expectedFingerprint,
            errorCode: '',
            generatedAt: new Date(),
          },
        },
        { new: true, runValidators: true }
      );

      if (!updated) {
        throw errorWithCode('VIDEO_PLAN_CONFLICT', 409, 'Конфликт одновременного сохранения видео кадра');
      }

      dbCommitted = true;
      outcome = 'replaced';
      savedVideo = updated;
      if (previous.storageKey && previous.storageKey !== stored.storageKey) {
        oldStorageKeyToDelete = previous.storageKey;
      }
    } else {
      try {
        const created = await StoryboardVideo.create({
          userId,
          projectId: project._id,
          frameId,
          status: 'ready',
          storageKey: stored.storageKey,
          mimeType: 'video/mp4',
          filename: stored.filename,
          byteSize: stored.byteSize,
          durationSec: mp4Meta.durationSec,
          width: mp4Meta.width,
          height: mp4Meta.height,
          generationProfileId: FLOW_VIDEO_PROFILE,
          provider: FLOW_VIDEO_PROVIDER,
          inputFingerprint: freshVerification.expectedFingerprint,
          errorCode: '',
          generatedAt: new Date(),
        });
        dbCommitted = true;
        outcome = 'imported';
        savedVideo = created;
      } catch (err) {
        if (err.code === 11000) {
          throw errorWithCode('VIDEO_PLAN_CONFLICT', 409, 'Конфликт одновременного сохранения видео кадра');
        }
        throw err;
      }
    }
  } finally {
    // If DB write did not commit, ALWAYS clean up newly saved file
    if (!dbCommitted && stored?.storageKey) {
      await deleteStoryboardVideoFile(stored.storageKey, project.projectPath, userId).catch(() => {});
    }
  }

  // 7. Delete old file after successful DB commit (failure to delete does not rollback new video)
  if (oldStorageKeyToDelete) {
    await deleteStoryboardVideoFile(oldStorageKeyToDelete, project.projectPath, userId)
      .catch(err => console.error('FLOW_VIDEO_OLD_FILE_DELETE_FAILED', err?.message));
  }

  const warnings = [];
  if (Math.abs(mp4Meta.durationSec - initialVerification.timing.targetDurationSec) > 0.5) {
    warnings.push(`Фактическая длительность видео (${mp4Meta.durationSec.toFixed(2)} с) отличается от целевой (${initialVerification.timing.targetDurationSec.toFixed(2)} с).`);
  }

  return {
    success: true,
    result: {
      frameId,
      outcome,
      warnings,
      video: {
        status: savedVideo.status,
        mimeType: savedVideo.mimeType,
        filename: savedVideo.filename,
        byteSize: savedVideo.byteSize,
        durationSec: savedVideo.durationSec,
        width: savedVideo.width,
        height: savedVideo.height,
        generationProfileId: savedVideo.generationProfileId,
        provider: savedVideo.provider,
        errorCode: savedVideo.errorCode,
        generatedAt: savedVideo.generatedAt,
      },
    },
  };
}
