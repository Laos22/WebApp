import { normalizeVideoPlan, patchVideoPlan } from './videoPlanService.js';
import { DEFAULT_VIDEO_PLAN_ANALYSIS_PROMPT, DEFAULT_VIDEO_PROMPT_PREPARATION_PROMPT } from '../models/Settings.js';

export function videoError(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}
export function classifyVideoError(error) {
  if (Number(error?.status || error?.code || error?.response?.status || error?.error?.code) === 429 || /(?:resource_exhausted|rate.?limit|quota)/i.test(String(error?.message || ''))) {
    const raw = error?.response?.headers?.get?.('retry-after') ?? error?.response?.headers?.['retry-after'];
    const delay = raw == null ? NaN : (/^\d+(\.\d+)?$/.test(String(raw)) ? Number(raw) * 1000 : Date.parse(raw) - Date.now());
    return { status: 429, code: 'AI_RATE_LIMIT', error: 'Временное ограничение ИИ. Повторите позже.',
      ...(Number.isFinite(delay) ? { retryAfterMs: Math.max(1000, delay) } : {}) };
  }
  const messages = {
    INVALID_AI_RESPONSE: 'Неверный ответ ИИ. Повторите запрос позже.',
    VIDEO_PLAN_CONFLICT: 'Конфликт редактирования. Обновите данные и повторите сохранение.',
    FRAME_CHANGED: 'Кадр или раскадровка изменены. Обновите данные.',
    IMAGE_MISSING: 'Изображение отсутствует или устарело.',
    INVALID_VIDEO_PLAN: 'Некорректные данные видеоплана.',
    INVALID_VIDEO_FRAME: 'Некорректные данные кадра.',
    UNKNOWN_FRAME_ID: 'Кадр изменён или удалён. Обновите данные.',
    DUPLICATE_FRAME_ID: 'Кадр указан несколько раз.',
    PLAN_NOT_READY: 'Выберите кадры и подготовьте непустой промт для каждого выбранного кадра.',
    INPUT_TOO_LARGE: 'Данные кадра слишком велики. Сократите описание или инструкции.',
  };
  return { status: messages[error?.code] ? error.status || 400 : 503,
    code: messages[error?.code] ? error.code : 'VIDEO_PLAN_FAILED',
    error: messages[error?.code] || 'Не удалось обработать видеоплан. Повторите позже.' };
}

// Bound both frame count and source text; large voiceover blocks are split further.
export function analysisChunks(project) {
  const groups = new Map();
  for (const frame of project.storyboard?.frames || []) {
    const key = frame.sourceVoiceoverBlockId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(frame);
  }
  const chunks = [];
  for (const [blockId, frames] of groups) {
    let chunk = [], size = 0;
    for (const frame of frames) {
      const length = JSON.stringify(frame).length;
      if (chunk.length && (chunk.length >= 8 || size + length > 24000)) {
        chunks.push({ blockId, frameIds: chunk }); chunk = []; size = 0;
      }
      chunk.push(frame.id); size += length;
    }
    if (chunk.length) chunks.push({ blockId, frameIds: chunk });
  }
  return chunks;
}
export function assertVideoVersion(project, version) {
  if (!Number.isSafeInteger(version) || version < 0) throw videoError('INVALID_VIDEO_PLAN');
  if (normalizeVideoPlan(project).editVersion !== version) throw videoError('VIDEO_PLAN_CONFLICT', 409);
  if (project.storyboard?.status !== 'confirmed') throw videoError('FRAME_CHANGED', 409);
}
function references(project, frames) {
  const ids = new Set(frames.flatMap(f => f.referenceIds || []));
  return (project.referencePlan?.items || []).filter(r => r.selected && ids.has(r.id))
    .map(({ id, name, type, description, prompt }) => ({ id, name, type, description, prompt }));
}
function fill(template, values) {
  const result = template.replace(/\{\{([A-Z_]+)\}\}/g, (token, key) => key in values
    ? (typeof values[key] === 'string' ? values[key] : JSON.stringify(values[key])) : token);
  if (result.length > 70000) throw videoError('INPUT_TOO_LARGE');
  return result;
}
export function analysisPrompt(project, chunk, response, template) {
  const frames = project.storyboard.frames.filter(f => chunk.frameIds.includes(f.id));
  const block = project.voiceover?.blocks?.find(b => b.id === chunk.blockId);
  return fill(template?.trim() || DEFAULT_VIDEO_PLAN_ANALYSIS_PROMPT, {
    PROJECT_TITLE: project.title, VOICEOVER_BLOCK: { id: chunk.blockId, title: block?.sourceTitle,
      text: frames.map(f => f.scriptText).join('\n') },
    FRAMES: frames.map(f => ({ frameId: f.id, text: f.scriptText, visualDescription: f.visualDescription,
      imagePrompt: f.prompt, referenceIds: f.referenceIds,
      durationSec: response.frames.find(item => item.frameId === f.id)?.targetDurationSec })),
    REFERENCES: references(project, frames), INSTRUCTIONS: normalizeVideoPlan(project).instructions,
  });
}
export function applyAnalysis(project, chunk, text, version) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw videoError('INVALID_AI_RESPONSE', 502); }
  const frames = parsed?.frames;
  if (!Array.isArray(frames) || frames.length !== chunk.frameIds.length ||
      new Set(frames.map(f => f?.frameId)).size !== frames.length || frames.some(f => !f ||
        !chunk.frameIds.includes(f.frameId) || typeof f.selected !== 'boolean' ||
        typeof f.videoPrompt !== 'string' || f.videoPrompt.length > 12000 || (f.selected && !f.videoPrompt.trim())))
    throw videoError('INVALID_AI_RESPONSE', 502);
  const plan = patchVideoPlan(project, { expectedEditVersion: version,
    frames: frames.map(f => ({ frameId: f.frameId, selected: f.selected, videoPrompt: f.selected ? f.videoPrompt : '' })) });
  plan.frames = plan.frames.map(f => chunk.frameIds.includes(f.frameId)
    ? { ...f, promptStatus: 'pending', promptErrorCode: '' } : f);
  return plan;
}
export function preparationPrompt(project, frameId, response, template) {
  const frame = project.storyboard.frames.find(f => f.id === frameId);
  const display = response.frames.find(f => f.frameId === frameId);
  const saved = normalizeVideoPlan(project).frames.find(f => f.frameId === frameId);
  if (!frame || !saved?.selected) throw videoError('FRAME_CHANGED', 409);
  if (!display?.hasImage) throw videoError('IMAGE_MISSING');
  if (!Number.isFinite(display.targetDurationSec)) throw videoError('FRAME_CHANGED', 409);
  return fill(template?.trim() || DEFAULT_VIDEO_PROMPT_PREPARATION_PROMPT, {
    PROJECT_TITLE: project.title, FRAME: { text: frame.scriptText, visualDescription: frame.visualDescription },
    FRAME_DURATION: display.targetDurationSec, IMAGE_PROMPT: frame.prompt, REFERENCES: references(project, [frame]),
    CURRENT_VIDEO_PROMPT: saved.videoPrompt, INSTRUCTIONS: normalizeVideoPlan(project).instructions,
  }) + '\nOutput only the final English motion prompt, without JSON or Markdown. The provided image is the first video frame. Preserve its composition, character appearance, clothing, objects and environment. Describe natural restrained action and camera movement within the target duration. No scene changes, new objects, text, logos or editing cuts.';
}
export function applyPreparedPrompt(project, frameId, text, version) {
  if (typeof text !== 'string' || !text.trim() || text.length > 12000 ||
      /^[\s]*[\[{<]/.test(text) || /```|^\s*(?:#{1,6} |[-*] |\d+\. )/m.test(text) || !/[a-z]{3}/i.test(text) || /[\u0400-\u04ff]/.test(text))
    throw videoError('INVALID_AI_RESPONSE', 502);
  const frame = normalizeVideoPlan(project).frames.find(f => f.frameId === frameId);
  if (!frame?.selected) throw videoError('FRAME_CHANGED', 409);
  const plan = patchVideoPlan(project, { expectedEditVersion: version,
    frames: [{ frameId, selected: true, videoPrompt: text.trim() }] });
  plan.frames = plan.frames.map(f => f.frameId === frameId ? { ...f, promptStatus: 'ready', promptUpdatedAt: new Date(), promptErrorCode: '' } : f);
  return plan;
}
export function confirmVideoPlan(project, version) {
  assertVideoVersion(project, version);
  const plan = normalizeVideoPlan(project);
  const selected = plan.frames.filter(f => f.selected);
  if (plan.status === 'stale' || plan.status === 'empty' || project.videoPlan?.frames?.length !== plan.frames.length ||
      project.videoPlan.frames.some((f, i) => f.frameId !== plan.frames[i].frameId))
    throw videoError('FRAME_CHANGED', 409);
  if (!selected.length || selected.some(f => f.promptStatus !== 'ready' || !f.videoPrompt.trim())) throw videoError('PLAN_NOT_READY');
  return { ...plan, status: 'confirmed', editVersion: plan.editVersion + 1, revision: plan.revision + 1,
    confirmedAt: new Date(), updatedAt: new Date() };
}
export function resetVideoPrompts(project, version) {
  const plan = patchVideoPlan(project, { expectedEditVersion: version, frames: [] });
  plan.frames = plan.frames.map(f => f.selected ? { ...f, promptStatus: 'pending', promptErrorCode: '' } : f);
  return plan;
}
