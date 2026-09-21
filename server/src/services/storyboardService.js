import { randomUUID } from 'node:crypto';

const frameIdPattern = /^frame_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalid(code = 'INVALID_STORYBOARD') {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length <= max ? text : text.slice(0, max);
}

export function emptyStoryboard() {
  return {
    status: 'empty', revision: 0, editVersion: 0,
    sourceScriptRevision: null, sourceReferencePlanRevision: null, sourceVoiceoverRevision: null,
    instructions: '', frames: [], updatedAt: null, confirmedAt: null,
  };
}

export function normalizeStoryboard(project) {
  const source = project?.storyboard?.toObject?.() ?? project?.storyboard;
  return source && typeof source === 'object' ? source : emptyStoryboard();
}

function normalizeReferenceIds(value, allowedReferenceIds) {
  if (!Array.isArray(value) || value.length > 100) invalid();
  const unique = [...new Set(value)];
  if (unique.some(id => typeof id !== 'string' || !allowedReferenceIds.has(id))) invalid();
  return unique;
}

function normalizedNarration(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function narrationWords(value) {
  const normalized = normalizedNarration(value);
  return normalized ? normalized.split(' ') : [];
}

function distributeWords(totalWords, frameCount) {
  if (frameCount < 1) return null;
  if (totalWords < 5) return frameCount === 1 ? [totalWords] : null;
  if (totalWords < frameCount * 5 || totalWords > frameCount * 15) return null;
  const base = Math.floor(totalWords / frameCount);
  const remainder = totalWords % frameCount;
  return Array.from({ length: frameCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function planStoryboardFrames(blocks) {
  if (!blocks.length) invalid('INVALID_STORYBOARD_RESPONSE');
  const plans = blocks.map(block => {
    const words = narrationWords(block.adaptedText);
    if (!words.length) invalid('INVALID_STORYBOARD_RESPONSE');
    return { block, words, count: Math.ceil(words.length / 15), target: Math.ceil(words.length / 12) };
  });
  let total = plans.reduce((sum, plan) => sum + plan.count, 0);
  if (total > 200) invalid('STORYBOARD_TOO_MANY_FRAMES');
  for (const plan of plans) {
    const extra = Math.min(plan.target - plan.count, 200 - total);
    plan.count += extra;
    total += extra;
  }
  const frames = [];
  for (const { block, words, count } of plans) {
    let offset = 0;
    for (const size of distributeWords(words.length, count)) {
      frames.push({ slot: String(frames.length + 1), sourceVoiceoverBlockId: block.id,
        scriptText: words.slice(offset, offset + size).join(' ') });
      offset += size;
    }
  }
  return frames;
}

// Only complete, validated batches are assembled; callers save after all succeed.
export async function generatePlannedStoryboard(plan, allowedReferenceIds, requestBatch) {
  const frames = [];
  for (let offset = 0; offset < plan.length; offset += 12) {
    const batch = plan.slice(offset, offset + 12);
    let validated;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await requestBatch(batch, attempt);
      try {
        const values = JSON.parse(raw)?.frames;
        if (!Array.isArray(values) || values.length !== batch.length) throw new Error();
        const bySlot = new Map(values.map(value => [value.slot, value]));
        if (bySlot.size !== batch.length) throw new Error();
        validated = batch.map(({ slot, ...frame }) => {
          const value = bySlot.get(slot);
          if (!value || typeof value.visualDescription !== 'string' || !value.visualDescription.trim() ||
              value.visualDescription.length > 4000 || typeof value.prompt !== 'string' ||
              !value.prompt.trim() || value.prompt.length > 12000) throw new Error();
          return { ...frame, visualDescription: value.visualDescription.trim(), prompt: value.prompt.trim(),
            referenceIds: normalizeReferenceIds(value.referenceIds, allowedReferenceIds) };
        });
        break;
      } catch {
        if (attempt === 1) invalid('INVALID_STORYBOARD_RESPONSE');
      }
    }
    frames.push(...validated);
  }
  return JSON.stringify({ frames });
}

// The server chooses the number/order of frames and Gemini creates visual content.
// The server restores scriptText from the approved narration so a harmless
// punctuation change or paraphrase cannot break exact text coverage.
function restoreGeneratedNarration(frames, voiceoverBlocks) {
  for (const block of voiceoverBlocks) {
    const blockFrames = frames.filter(frame => frame.sourceVoiceoverBlockId === block.id);
    const words = narrationWords(block.adaptedText);
    const sizes = distributeWords(words.length, blockFrames.length);
    if (!sizes) invalid('STORYBOARD_FRAME_WORD_LIMIT_MISMATCH');
    let offset = 0;
    blockFrames.forEach((frame, index) => {
      frame.scriptText = words.slice(offset, offset + sizes[index]).join(' ');
      offset += sizes[index];
    });
  }
}

function normalizeFrames(input, currentFrames, allowedReferenceIds, voiceoverBlocks, generated) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 200) invalid(generated ? 'INVALID_STORYBOARD_RESPONSE' : 'INVALID_STORYBOARD');
  const existing = new Map(currentFrames.map(frame => [frame.id, frame]));
  const allowedBlocks = new Map(voiceoverBlocks.map(block => [block.id, block]));
  const used = new Set();
  const frames = input.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(generated ? 'INVALID_STORYBOARD_RESPONSE' : 'INVALID_STORYBOARD');
    if (Object.keys(value).some(key => !['id', 'sourceVoiceoverBlockId', 'scriptText', 'visualDescription', 'prompt', 'referenceIds', 'animation', 'marker'].includes(key))) invalid(generated ? 'INVALID_STORYBOARD_RESPONSE' : 'INVALID_STORYBOARD');
    let id = typeof value.id === 'string' && frameIdPattern.test(value.id) && existing.has(value.id)
      ? value.id : generated || !value.id ? `frame_${randomUUID()}` : invalid();
    while (used.has(id)) id = `frame_${randomUUID()}`;
    used.add(id);
    const scriptText = cleanText(value.scriptText, 4000);
    const sourceVoiceoverBlockId = cleanText(value.sourceVoiceoverBlockId, 80);
    const visualDescription = cleanText(value.visualDescription, 4000);
    const prompt = cleanText(value.prompt, 12000);
    if (!scriptText || !visualDescription || !prompt || !allowedBlocks.has(sourceVoiceoverBlockId)) invalid(generated ? 'INVALID_STORYBOARD_RESPONSE' : 'INVALID_STORYBOARD');
    const previous = existing.get(id);
    const animation = value.animation ?? previous?.animation ?? '';
    const marker = value.marker ?? previous?.marker ?? '';
    if (!['', 'Zoom In', 'Zoom Out', 'Pan Left', 'Pan Right', 'Pan Up', 'Pan Down'].includes(animation) ||
        typeof marker !== 'string' || marker.length > 2000) invalid();
    const keepDetailState = !generated && previous && prompt === previous.prompt;
    return {
      id, order: index + 1, sourceVoiceoverBlockId, scriptText, visualDescription, prompt, animation, marker,
      referenceIds: normalizeReferenceIds(value.referenceIds ?? [], allowedReferenceIds),
      promptDetailStatus: keepDetailState ? previous.promptDetailStatus || 'pending' : 'pending',
      promptDetailedAt: keepDetailState ? previous.promptDetailedAt || null : null,
      promptDetailErrorCode: keepDetailState ? previous.promptDetailErrorCode || '' : '',
    };
  });
  if (generated) restoreGeneratedNarration(frames, voiceoverBlocks);
  let lastBlockOrder = 0;
  for (const block of voiceoverBlocks) {
    const blockFrames = frames.filter(frame => frame.sourceVoiceoverBlockId === block.id);
    if (!blockFrames.length || normalizedNarration(blockFrames.map(frame => frame.scriptText).join(' ')) !== normalizedNarration(block.adaptedText)) {
      invalid(generated ? 'STORYBOARD_TEXT_COVERAGE_MISMATCH' : 'INVALID_STORYBOARD');
    }
  }
  for (const frame of frames) {
    const order = allowedBlocks.get(frame.sourceVoiceoverBlockId).order;
    if (order < lastBlockOrder) invalid(generated ? 'STORYBOARD_TEXT_COVERAGE_MISMATCH' : 'INVALID_STORYBOARD');
    lastBlockOrder = order;
  }
  return frames;
}

export function parseGeneratedStoryboard(rawText, currentFrames, allowedReferenceIds, voiceoverBlocks) {
  let parsed;
  try { parsed = JSON.parse(rawText); } catch { invalid('INVALID_STORYBOARD_RESPONSE'); }
  const frames = Array.isArray(parsed) ? parsed : parsed?.frames;
  return normalizeFrames(frames, currentFrames, allowedReferenceIds, voiceoverBlocks, true);
}

export function validateStoryboardFrames(input, currentFrames, allowedReferenceIds, voiceoverBlocks) {
  return normalizeFrames(input, currentFrames, allowedReferenceIds, voiceoverBlocks, false);
}

// Mongoose storyboard subdocuments contain internal fields (order and prompt
// detail state) that are not accepted as editable input. Keep only the fields
// a user is allowed to send back when validating a single-frame update.
export function storyboardEditableFrame(frame = {}) {
  return {
    ...(frame.id ? { id: frame.id } : {}),
    sourceVoiceoverBlockId: frame.sourceVoiceoverBlockId || '',
    animation: frame.animation || '',
    marker: frame.marker || '',
    scriptText: frame.scriptText || '',
    visualDescription: frame.visualDescription || '',
    prompt: frame.prompt || '',
    referenceIds: Array.from(frame.referenceIds || []),
  };
}

export function rebaseStoryboardNarration(currentFrames, voiceoverBlocks) {
  const editable = currentFrames.map(storyboardEditableFrame);
  const blockById = new Map(voiceoverBlocks.map(block => [block.id, block]));
  if (!editable.length || editable.some(frame => !blockById.has(frame.sourceVoiceoverBlockId))) {
    invalid('STORYBOARD_VOICEOVER_STRUCTURE_MISMATCH');
  }
  for (const block of voiceoverBlocks) {
    const indexes = editable
      .map((frame, index) => frame.sourceVoiceoverBlockId === block.id ? index : -1)
      .filter(index => index >= 0);
    if (!indexes.length) invalid('STORYBOARD_VOICEOVER_STRUCTURE_MISMATCH');
    const words = narrationWords(block.adaptedText);
    const previousSizes = indexes.map(index => narrationWords(editable[index].scriptText).length);
    let sizes = previousSizes;
    const previousSizesValid = words.length < 5
      ? indexes.length === 1 && previousSizes[0] === words.length
      : previousSizes.every(size => size >= 5 && size <= 15);
    if (!previousSizesValid || previousSizes.reduce((sum, size) => sum + size, 0) !== words.length) {
      sizes = distributeWords(words.length, indexes.length);
    }
    if (!sizes) invalid('STORYBOARD_FRAME_WORD_LIMIT_MISMATCH');
    let offset = 0;
    indexes.forEach((frameIndex, position) => {
      editable[frameIndex].scriptText = words.slice(offset, offset + sizes[position]).join(' ');
      offset += sizes[position];
    });
  }
  return editable;
}

export function storyboardIsCurrent(project, storyboard = normalizeStoryboard(project)) {
  const plan = project?.referencePlan;
  const voiceover = project?.voiceover;
  return project?.script?.status === 'confirmed' && plan?.status === 'confirmed' && voiceover?.status === 'confirmed' &&
    storyboard.sourceScriptRevision === project.script.revision &&
    storyboard.sourceReferencePlanRevision === plan.revision &&
    storyboard.sourceVoiceoverRevision === voiceover.revision;
}

function sameReferenceIds(left, right) {
  return JSON.stringify(Array.from(left || [])) === JSON.stringify(Array.from(right || []));
}

// A storyboard revision describes the whole board. It must not invalidate an
// unchanged frame image record when another frame is edited or the board is
// confirmed again. The record belongs to the stable frame id and its inputs.
export function storyboardImageMatchesFrame(image, frame) {
  return Boolean(image && frame &&
    image.sourcePrompt === frame.prompt &&
    sameReferenceIds(image.sourceReferenceIds, frame.referenceIds));
}
