import { createHash } from 'node:crypto';
import { timelinePlan, TIMEBASE } from './davinciXmlService.js';
import { storyboardImageMatchesFrame } from './storyboardService.js';

const plain = value => value?.toObject ? value.toObject() : value;
function storyboardFingerprint(project) {
  return createHash('sha256').update(JSON.stringify((project.storyboard?.frames || []).map(frame =>
    [frame.id, frame.sourceVoiceoverBlockId, frame.scriptText, frame.visualDescription, frame.prompt, [...(frame.referenceIds || [])].sort()]
  ))).digest('hex');
}
export function normalizeVideoPlan(project) {
  const stored = plain(project.videoPlan);
  const frames = project.storyboard?.frames || [];
  const byId = new Map((stored?.frames || []).map(frame => [frame.frameId, frame]));
  return {
    status: stored?.status && stored.status !== 'empty' &&
      (stored.sourceStoryboardRevision !== project.storyboard?.revision ||
        (stored.sourceStoryboardFingerprint && stored.sourceStoryboardFingerprint !== storyboardFingerprint(project))) ? 'stale' : stored?.status || 'empty',
    revision: stored?.revision || 0, editVersion: stored?.editVersion || 0,
    sourceStoryboardRevision: stored?.sourceStoryboardRevision ?? null,
    sourceStoryboardFingerprint: stored?.sourceStoryboardFingerprint || "",
    instructions: stored?.instructions || '', updatedAt: stored?.updatedAt || null,
    confirmedAt: stored?.confirmedAt || null,
    frames: frames.map(frame => byId.get(frame.id) || {
      frameId: frame.id, selected: false, videoPrompt: '', promptStatus: 'pending',
      promptErrorCode: '', promptUpdatedAt: null,
    }),
  };
}
function fail(code) { throw Object.assign(new Error(code), { code, status: 400 }); }
export function patchVideoPlan(project, body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['expectedEditVersion', 'frames', 'instructions'].includes(key)) ||
      !Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 0 ||
      !Array.isArray(body.frames) || body.frames.length > 1000 ||
      (body.instructions !== undefined && (typeof body.instructions !== 'string' || body.instructions.length > 4000))) fail('INVALID_VIDEO_PLAN');
  const plan = normalizeVideoPlan(project);
  const patches = new Map();
  const ids = new Set(plan.frames.map(frame => frame.frameId));
  for (const frame of body.frames) {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) ||
        Object.keys(frame).some(key => !['frameId', 'selected', 'videoPrompt'].includes(key)) ||
        typeof frame.frameId !== 'string' || typeof frame.selected !== 'boolean' ||
        typeof frame.videoPrompt !== 'string' || frame.videoPrompt.length > 12000) fail('INVALID_VIDEO_FRAME');
    if (patches.has(frame.frameId)) fail('DUPLICATE_FRAME_ID');
    if (!ids.has(frame.frameId)) fail('UNKNOWN_FRAME_ID');
    patches.set(frame.frameId, frame);
  }
  if (plan.editVersion !== body.expectedEditVersion)
    throw Object.assign(new Error('VIDEO_PLAN_CONFLICT'), { code: 'VIDEO_PLAN_CONFLICT', status: 409 });
  return { ...plan, status: 'draft', revision: plan.revision + 1, editVersion: plan.editVersion + 1,
    sourceStoryboardRevision: project.storyboard?.revision ?? 0,
    sourceStoryboardFingerprint: storyboardFingerprint(project),
    instructions: body.instructions === undefined ? plan.instructions : body.instructions.trim(),
    updatedAt: now, confirmedAt: null,
    frames: plan.frames.map(frame => {
      const patch = patches.get(frame.frameId);
      if (!patch) return frame;
      const videoPrompt = patch.videoPrompt.trim();
      const changed = videoPrompt !== frame.videoPrompt;
      return { ...frame, selected: patch.selected, videoPrompt,
        ...(changed ? { promptStatus: videoPrompt ? 'ready' : 'pending', promptErrorCode: '', promptUpdatedAt: now } : {}) };
    }),
  };
}

// Fingerprint v1 is frame-local, never includes the overall storyboard revision.
// Image replacement is identified by storage key AND generation timestamp (not bookkeeping updatedAt).
export function videoInputFingerprint({ frame, planFrame, image, durationSec, generationProfileId = '', provider = '' }) {
  return createHash('sha256').update(JSON.stringify({ version: 1, frameId: frame.id,
    scriptText: frame.scriptText, imagePrompt: frame.prompt, referenceIds: [...(frame.referenceIds || [])].sort(),
    image: image ? [String(image._id || ''), image.storageKey, image.generatedAt, image.byteSize] : null,
    videoPrompt: planFrame.videoPrompt, durationSec, generationProfileId, provider,
  })).digest('hex');
}
export function videoPlanResponse(project, images = [], videos = []) {
  const videoPlan = normalizeVideoPlan(project);
  const frames = project.storyboard?.frames || [];
  const timings = new Map();
  let timingErrorCode = null;
  if (frames.length) {
    try {
      for (const item of timelinePlan(project.voiceover?.blocks || [], frames).blocks) {
        item.frames.forEach((frame, index) => timings.set(frame.id, {
          blockNumber: item.block.order, frameInBlock: index + 1,
          targetDurationSec: item.durations[index] / TIMEBASE, durationExact: item.exact,
        }));
      }
    } catch (error) { timingErrorCode = error.code || 'VIDEO_TIMING_UNAVAILABLE'; }
  }
  const imageById = new Map(images.map(image => [image.frameId, image]));
  const videoById = new Map(videos.map(video => [video.frameId, plain(video)]));
  return { success: true, projectTitle: project.title, videoPlan, timingErrorCode,
    timingSettings: { frameRate: 24, charsPerSecond: 15 },
    frames: frames.map((frame, index) => {
      const sourceImage = imageById.get(frame.id);
      const hasImage = project.storyboard.status === 'confirmed' && sourceImage?.status === 'ready' &&
        Boolean(sourceImage.storageKey) && storyboardImageMatchesFrame(sourceImage, frame);
      const timing = timings.get(frame.id);
      const block = project.voiceover?.blocks?.find(block => block.id === frame.sourceVoiceoverBlockId);
      const video = videoById.get(frame.id);
      const fingerprint = videoInputFingerprint({ frame, planFrame: videoPlan.frames[index],
        image: hasImage ? sourceImage : null, durationSec: timing?.targetDurationSec ?? null,
        generationProfileId: video?.generationProfileId, provider: video?.provider });
      // Explicit allowlist: internal file keys and provider operation IDs never leave the server.
      const safeVideo = video ? Object.fromEntries(['status', 'mimeType', 'filename', 'byteSize', 'durationSec',
        'width', 'height', 'generationProfileId', 'provider', 'errorCode', 'generatedAt'].map(key => [key, video[key]])) : null;
      if (safeVideo?.status === 'ready' && (!hasImage || !timing || video.inputFingerprint !== fingerprint)) safeVideo.status = 'stale';
      return { frameId: frame.id, blockNumber: block?.order ?? null,
        frameInBlock: frames.filter(item => item.sourceVoiceoverBlockId === frame.sourceVoiceoverBlockId).findIndex(item => item.id === frame.id) + 1,
        text: frame.scriptText, hasImage,
        previewUrl: hasImage ? `/api/projects/${project._id}/storyboard/frames/${encodeURIComponent(frame.id)}/image?preview=1&v=${encodeURIComponent(sourceImage.updatedAt || sourceImage.generatedAt || '0')}` : null,
        targetDurationSec: null, durationExact: false, ...timing, video: safeVideo };
    }),
  };
}
