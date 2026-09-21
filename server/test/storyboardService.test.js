import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStoryboard, parseGeneratedStoryboard, storyboardEditableFrame, storyboardIsCurrent,
  storyboardImageMatchesFrame, validateStoryboardFrames,
} from '../src/services/storyboardService.js';

const referenceId = 'ref_11111111-1111-4111-8111-111111111111';
const allowed = new Set([referenceId]);
const voiceBlock = {
  id: 'voice_block_11111111-1111-4111-8111-111111111111',
  order: 1, adaptedText: 'Текст сценария',
};
const voiceBlocks = [voiceBlock];

test('generated storyboard receives stable server frame ids and approved references', () => {
  const frames = parseGeneratedStoryboard(JSON.stringify({ frames: [{
    sourceVoiceoverBlockId: voiceBlock.id, scriptText: voiceBlock.adaptedText,
    visualDescription: 'Описание кадра', prompt: 'A cinematic frame', referenceIds: [referenceId],
  }] }), [], allowed, voiceBlocks);
  assert.equal(frames.length, 1);
  assert.match(frames[0].id, /^frame_/);
  assert.equal(frames[0].order, 1);
  assert.deepEqual(frames[0].referenceIds, [referenceId]);
});

test('unknown reference ids from AI are rejected', () => {
  assert.throws(() => parseGeneratedStoryboard(JSON.stringify({ frames: [{
    sourceVoiceoverBlockId: voiceBlock.id, scriptText: voiceBlock.adaptedText,
    visualDescription: 'Описание', prompt: 'Prompt',
    referenceIds: ['ref_22222222-2222-4222-8222-222222222222'],
  }] }), [], allowed, voiceBlocks));
});

test('generated frame text is restored exactly from narration in 5-15 word chunks', () => {
  const adaptedText = Array.from({ length: 31 }, (_, index) => `слово${index + 1}`).join(' ');
  const block = { ...voiceBlock, adaptedText };
  const frames = parseGeneratedStoryboard(JSON.stringify({ frames: [
    { sourceVoiceoverBlockId: block.id, scriptText: 'ИИ изменил первый фрагмент', visualDescription: 'Кадр 1', prompt: 'Frame 1', referenceIds: [] },
    { sourceVoiceoverBlockId: block.id, scriptText: 'ИИ пропустил часть текста', visualDescription: 'Кадр 2', prompt: 'Frame 2', referenceIds: [] },
    { sourceVoiceoverBlockId: block.id, scriptText: 'Неточное завершение', visualDescription: 'Кадр 3', prompt: 'Frame 3', referenceIds: [] },
  ] }), [], allowed, [block]);
  const counts = frames.map(frame => frame.scriptText.split(' ').length);
  assert.deepEqual(counts, [11, 10, 10]);
  assert.equal(frames.map(frame => frame.scriptText).join(' '), adaptedText);
});

test('generated storyboard rejects a frame count incompatible with 5-15 words', () => {
  const block = { ...voiceBlock, adaptedText: Array.from({ length: 31 }, (_, index) => `слово${index + 1}`).join(' ') };
  assert.throws(() => parseGeneratedStoryboard(JSON.stringify({ frames: [{
    sourceVoiceoverBlockId: block.id, scriptText: block.adaptedText,
    visualDescription: 'Один кадр', prompt: 'One frame', referenceIds: [],
  }] }), [], allowed, [block]), error => error.code === 'STORYBOARD_FRAME_WORD_LIMIT_MISMATCH');
});

test('manual edits preserve frame ids and exact narration coverage', () => {
  const current = parseGeneratedStoryboard(JSON.stringify({ frames: [{
    sourceVoiceoverBlockId: voiceBlock.id, scriptText: voiceBlock.adaptedText,
    visualDescription: 'Описание', prompt: 'Prompt', referenceIds: [],
  }] }), [], allowed, voiceBlocks);
  const editable = {
    id: current[0].id, sourceVoiceoverBlockId: voiceBlock.id, scriptText: current[0].scriptText,
    visualDescription: current[0].visualDescription, prompt: 'Updated prompt', referenceIds: [],
  };
  const edited = validateStoryboardFrames([editable], current, allowed, voiceBlocks);
  assert.equal(edited[0].id, current[0].id);
  assert.throws(() => validateStoryboardFrames([{ ...editable, scriptText: 'Текст потерян' }], current, allowed, voiceBlocks));
  assert.throws(() => validateStoryboardFrames([{ ...editable, id: 'frame_33333333-3333-4333-8333-333333333333' }], current, allowed, voiceBlocks));
});

test('manual save preserves detail progress until the prompt changes', () => {
  const current = parseGeneratedStoryboard(JSON.stringify({ frames: [{
    sourceVoiceoverBlockId: voiceBlock.id, scriptText: voiceBlock.adaptedText,
    visualDescription: 'Описание', prompt: 'Detailed prompt', referenceIds: [],
  }] }), [], allowed, voiceBlocks);
  current[0].promptDetailStatus = 'ready';
  current[0].promptDetailedAt = new Date('2026-09-19T12:00:00Z');
  const input = {
    id: current[0].id, sourceVoiceoverBlockId: voiceBlock.id,
    scriptText: voiceBlock.adaptedText, visualDescription: 'Описание',
    prompt: 'Detailed prompt', referenceIds: [],
  };
  const unchanged = validateStoryboardFrames([input], current, allowed, voiceBlocks);
  assert.equal(unchanged[0].promptDetailStatus, 'ready');
  assert.ok(unchanged[0].promptDetailedAt);
  const changed = validateStoryboardFrames([{ ...input, prompt: 'Manual replacement' }], current, allowed, voiceBlocks);
  assert.equal(changed[0].promptDetailStatus, 'pending');
  assert.equal(changed[0].promptDetailedAt, null);
});

test('storyboard freshness follows script, voiceover and reference revisions', () => {
  const project = {
    script: { status: 'confirmed', revision: 3 },
    voiceover: { status: 'confirmed', revision: 4 },
    referencePlan: { status: 'confirmed', revision: 2 },
    storyboard: {
      status: 'confirmed', revision: 1, editVersion: 4,
      sourceScriptRevision: 3, sourceVoiceoverRevision: 4,
      sourceReferencePlanRevision: 2, frames: [],
    },
  };
  assert.equal(storyboardIsCurrent(project), true);
  project.voiceover.revision = 5;
  assert.equal(storyboardIsCurrent(project), false);
  assert.equal(normalizeStoryboard({}).status, 'empty');
});

test('frame image remains current after an unrelated storyboard revision change', () => {
  const frame = { id: 'frame_1', prompt: 'Same prompt', referenceIds: ['ref_1'] };
  const image = {
    status: 'ready', storageKey: 'projects/example/images/frame.jpg',
    sourceStoryboardRevision: 2, sourcePrompt: 'Same prompt', sourceReferenceIds: ['ref_1'],
  };
  assert.equal(storyboardImageMatchesFrame(image, frame), true);
  image.sourceStoryboardRevision = 99;
  assert.equal(storyboardImageMatchesFrame(image, frame), true);
});

test('frame image becomes stale only when its generation inputs change', () => {
  const image = {
    status: 'ready', storageKey: 'projects/example/images/frame.jpg',
    sourcePrompt: 'Original prompt', sourceReferenceIds: ['ref_1'],
  };
  assert.equal(storyboardImageMatchesFrame(image, {
    prompt: 'Changed prompt', referenceIds: ['ref_1'],
  }), false);
  assert.equal(storyboardImageMatchesFrame(image, {
    prompt: 'Original prompt', referenceIds: [],
  }), false);
});

test('single-frame validation strips stored internal fields', () => {
  const editable = storyboardEditableFrame({
    id: 'frame_11111111-1111-4111-8111-111111111111',
    order: 7,
    sourceVoiceoverBlockId: voiceBlock.id,
    scriptText: voiceBlock.adaptedText,
    visualDescription: 'Описание',
    prompt: 'Prompt',
    referenceIds: [referenceId],
    promptDetailStatus: 'ready',
    promptDetailedAt: new Date(),
    promptDetailErrorCode: '',
  });
  assert.deepEqual(Object.keys(editable), [
    'id', 'sourceVoiceoverBlockId', 'scriptText', 'visualDescription', 'prompt', 'referenceIds',
  ]);
  assert.deepEqual(editable.referenceIds, [referenceId]);
});
