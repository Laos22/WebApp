import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStoryboard, parseGeneratedStoryboard, rebaseStoryboardNarration,
  storyboardEditableFrame, storyboardIsCurrent,
  storyboardImageMatchesFrame, validateStoryboardFrames,
  planStoryboardFrames, generatePlannedStoryboard,
} from '../src/services/storyboardService.js';

const referenceId = 'ref_11111111-1111-4111-8111-111111111111';
const allowed = new Set([referenceId]);
const voiceBlock = {
  id: 'voice_block_11111111-1111-4111-8111-111111111111',
  order: 1, adaptedText: 'Текст сценария',
};
const voiceBlocks = [voiceBlock];

test('planning preserves every word and satisfies frame limits across narration lengths', () => {
  for (let length = 1; length <= 3000; length++) {
    const block = { ...voiceBlock, adaptedText: Array.from({ length }, (_, i) => `word${i}`).join(' ') };
    const plan = planStoryboardFrames([block]);
    assert.ok(plan.length <= 200);
    assert.equal(plan.map(frame => frame.scriptText).join(' '), block.adaptedText);
    assert.equal(new Set(plan.map(frame => frame.slot)).size, plan.length);
    for (const frame of plan) {
      const count = frame.scriptText.split(' ').length;
      assert.ok(count <= 15 && (count >= 5 || length < 5));
    }
  }
});

test('planning accounts for separate blocks and rejects impossible totals before generation', () => {
  const blocks = Array.from({ length: 200 }, (_, i) => ({ id: `block${i}`, order: i + 1, adaptedText: 'one two' }));
  assert.equal(planStoryboardFrames(blocks).length, 200);
  assert.throws(() => planStoryboardFrames([...blocks, { ...voiceBlock }]), { code: 'STORYBOARD_TOO_MANY_FRAMES' });
  assert.throws(() => planStoryboardFrames([{ ...voiceBlock, adaptedText: Array(3001).fill('word').join(' ') }]), { code: 'STORYBOARD_TOO_MANY_FRAMES' });
});

const visualBatch = batch => JSON.stringify({ frames: batch.map(frame => ({
  slot: frame.slot, visualDescription: `Scene ${frame.slot}`, prompt: `Image ${frame.slot}`, referenceIds: [referenceId],
})).reverse() });

test('batched generation orders slots, retains exact narration, and passes final validation', async () => {
  const blocks = [voiceBlock, { id: 'second', order: 2, adaptedText: Array.from({ length: 301 }, (_, i) => `word${i}`).join(' ') }];
  const plan = planStoryboardFrames(blocks);
  const original = structuredClone(plan);
  const sizes = [];
  const raw = await generatePlannedStoryboard(plan, allowed, async batch => {
    sizes.push(batch.length);
    return visualBatch(batch);
  });
  assert.deepEqual(sizes, [12, 12, 3]);
  assert.deepEqual(plan, original);
  const frames = parseGeneratedStoryboard(raw, [], allowed, blocks);
  assert.equal(frames.length, plan.length);
  frames.forEach((frame, index) => {
    assert.equal(frame.scriptText, plan[index].scriptText);
    assert.equal(frame.sourceVoiceoverBlockId, plan[index].sourceVoiceoverBlockId);
    assert.equal(frame.prompt, `Image ${index + 1}`);
  });
});

test('invalid batch is retried once without repeating completed batches', async () => {
  const plan = planStoryboardFrames([{ ...voiceBlock, adaptedText: Array(200).fill('word').join(' ') }]);
  const calls = [];
  await generatePlannedStoryboard(plan, allowed, async (batch, attempt) => {
    calls.push([batch[0].slot, attempt]);
    return batch[0].slot === '13' && attempt === 0 ? '{"frames":[]}' : visualBatch(batch);
  });
  assert.deepEqual(calls, [['1', 0], ['13', 0], ['13', 1]]);
});

test('missing, duplicate, unknown slots and invalid references fail after bounded retry', async () => {
  const plan = planStoryboardFrames([{ ...voiceBlock, adaptedText: Array(24).fill('word').join(' ') }]);
  for (const corrupt of [
    () => 'not json',
    frames => JSON.stringify({ frames: frames.slice(1) }),
    frames => JSON.stringify({ frames: [frames[0], frames[0]] }),
    frames => JSON.stringify({ frames: frames.map(frame => ({ ...frame, slot: 'unknown' })) }),
    frames => JSON.stringify({ frames: frames.map(frame => ({ ...frame, referenceIds: ['unknown'] })) }),
  ]) {
    let calls = 0;
    await assert.rejects(generatePlannedStoryboard(plan, allowed, async batch => {
      calls++;
      return corrupt(JSON.parse(visualBatch(batch)).frames);
    }), { code: 'INVALID_STORYBOARD_RESPONSE' });
    assert.equal(calls, 2);
  }
});

test('provider failure does not trigger extra paid requests', async () => {
  let calls = 0;
  await assert.rejects(generatePlannedStoryboard(planStoryboardFrames(voiceBlocks), allowed, async () => {
    calls++;
    throw new Error('provider unavailable');
  }), /provider unavailable/);
  assert.equal(calls, 1);
});

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
    'id', 'sourceVoiceoverBlockId', 'animation', 'marker', 'scriptText', 'visualDescription', 'prompt', 'referenceIds',
  ]);
  assert.deepEqual(editable.referenceIds, [referenceId]);
});

test('updated voiceover text is adopted without changing visual frame data', () => {
  const current = [
    {
      id: 'frame_11111111-1111-4111-8111-111111111111', sourceVoiceoverBlockId: voiceBlock.id,
      scriptText: 'Первый старый текст содержит ровно пять', visualDescription: 'Visual 1', prompt: 'Prompt 1',
      referenceIds: [referenceId],
    },
    {
      id: 'frame_22222222-2222-4222-8222-222222222222', sourceVoiceoverBlockId: voiceBlock.id,
      scriptText: 'Второй старый текст тоже пять', visualDescription: 'Visual 2', prompt: 'Prompt 2',
      referenceIds: [],
    },
  ];
  const blocks = [{ ...voiceBlock, adaptedText: 'Первый новый текст содержит ровно пять Второй новый текст тоже пять' }];
  const rebased = rebaseStoryboardNarration(current, blocks);
  assert.equal(rebased.map(frame => frame.scriptText).join(' '), blocks[0].adaptedText);
  assert.equal(rebased[0].prompt, 'Prompt 1');
  assert.deepEqual(rebased[0].referenceIds, [referenceId]);
  assert.equal(rebased[1].id, current[1].id);
});

test('editing animation and marker preserves image inputs, frame IDs and freshness', () => {
  const frame = { id: 'frame_11111111-1111-4111-8111-111111111111', sourceVoiceoverBlockId: voiceBlock.id,
    scriptText: voiceBlock.adaptedText, visualDescription: 'Описание', prompt: 'Prompt', referenceIds: [referenceId] };
  const [updated] = validateStoryboardFrames([{ ...frame, animation: 'Zoom In', marker: 'Маркер' }], [frame], allowed, voiceBlocks);
  assert.equal(updated.id, frame.id);
  assert.equal(updated.prompt, frame.prompt);
  assert.deepEqual(updated.referenceIds, frame.referenceIds);
  assert.equal(updated.animation, 'Zoom In');
  assert.equal(updated.marker, 'Маркер');
  assert.ok(storyboardImageMatchesFrame({ sourcePrompt: frame.prompt, sourceReferenceIds: frame.referenceIds }, updated));
  const [preserved] = validateStoryboardFrames([frame], [updated], allowed, voiceBlocks);
  assert.equal(preserved.marker, 'Маркер');
});
