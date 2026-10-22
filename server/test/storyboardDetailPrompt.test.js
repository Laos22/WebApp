import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY ||= 'test-encryption-key-that-is-longer-than-32-characters';

const {
  buildStoryboardBatchPrompt, buildStoryboardDetailPrompt, buildStoryboardPrompt,
  geminiRetryAfterMs, isGeminiRateLimitError, retryGeminiRateLimit,
} = await import('../src/services/geminiService.js');

test('a storyboard batch excludes the rest of a long script and distant frame prompts', () => {
  const blocks = Array.from({ length: 12 }, (_, index) => ({
    id: `block-${index + 1}`, order: index + 1,
    adaptedText: `${`near-${index + 1} `.repeat(120)}unique-${index + 1}`,
  }));
  const project = { title: 'Long story', script: { content: 'FULL_SCRIPT_SENTINEL '.repeat(1000) },
    voiceover: { blocks } };
  const references = [{ id: 'ref-1', name: 'Ship', description: 'reference '.repeat(500),
    prompt: 'prompt '.repeat(500) }];
  const plan = blocks.flatMap((block, index) => Array.from({ length: 10 }, (_, frame) => ({
    slot: String(index * 10 + frame + 1), sourceVoiceoverBlockId: block.id,
    scriptText: `${block.id}-frame-${frame}`,
  })));
  const currentFrames = plan.map(frame => ({ ...frame, id: `id-${frame.slot}`,
    visualDescription: 'Existing', prompt: `old-prompt-${frame.slot}` }));
  const template = '{{SCRIPT}} {{VOICEOVER_BLOCKS}} {{REFERENCES}} {{CURRENT_STORYBOARD}}';
  const full = buildStoryboardPrompt(project, references, currentFrames, '', template);
  const scoped = buildStoryboardBatchPrompt(project, references, currentFrames, '', template, plan, plan.slice(50, 56));
  assert.ok(scoped.length < full.length / 4);
  assert.match(scoped, /block-6-frame-0/);
  assert.match(scoped, /old-prompt-51/);
  assert.doesNotMatch(scoped, /FULL_SCRIPT_SENTINEL/);
  assert.doesNotMatch(scoped, /unique-1/);
  assert.doesNotMatch(scoped, /old-prompt-1/);
});

test('a temporary Gemini rate limit retries but a daily limit does not', async () => {
  let calls = 0;
  const delays = [];
  const result = await retryGeminiRateLimit(async () => {
    if (calls++ === 0) throw { status: 429, message: 'Please retry in 2s' };
    return 'ready';
  }, { sleep: async delay => delays.push(delay) });
  assert.equal(result, 'ready');
  assert.equal(calls, 2);
  assert.ok(delays[0] >= 15_000);
  let dailyCalls = 0;
  await assert.rejects(retryGeminiRateLimit(async () => {
    dailyCalls++;
    throw Object.assign(new Error('RequestsPerDay quota exceeded'), { status: 429 });
  }, { sleep: async () => { throw new Error('unexpected retry'); } }), { status: 429 });
  assert.equal(dailyCalls, 1);
});

test('storyboard detail prompt includes frame and only selected references', () => {
  const project = { title: 'Тестовый проект' };
  const frame = {
    id: 'frame_1', order: 1, scriptText: 'Точный текст кадра',
    visualDescription: 'Герой стоит у окна', prompt: 'Current prompt',
    referenceIds: ['ref_selected'],
  };
  const references = [
    { id: 'ref_selected', name: 'Герой', type: 'character', description: 'Описание героя', prompt: 'Hero reference' },
    { id: 'ref_unused', name: 'Другой объект', type: 'object', description: 'Не используется', prompt: 'Unused' },
  ];
  const result = buildStoryboardDetailPrompt(
    project, frame, references, 'Больше деталей света',
    '{{PROJECT_TITLE}}|{{FRAME}}|{{REFERENCES}}|{{CURRENT_PROMPT}}|{{INSTRUCTION}}',
    true,
  );
  assert.match(result, /Тестовый проект/);
  assert.match(result, /Точный текст кадра/);
  assert.match(result, /ref_selected/);
  assert.doesNotMatch(result, /ref_unused/);
  assert.match(result, /Current prompt/);
  assert.match(result, /Больше деталей света/);
});

test('rebuilding a frame prompt uses the edited scene instead of a contradictory old prompt', () => {
  const project = { title: 'Чайка' };
  const frame = {
    id: 'frame_1', order: 1, scriptText: 'Корабль идёт по волнам',
    visualDescription: 'На казацкой чайке стоят казаки',
    prompt: 'An empty boat, no people visible', referenceIds: [],
    promptDetailStatus: 'stale',
  };
  const template = '{{FRAME}}\nOLD: {{CURRENT_PROMPT}}';
  const rebuilt = buildStoryboardDetailPrompt(project, frame, [], '', template);
  assert.match(rebuilt, /На казацкой чайке стоят казаки/);
  assert.doesNotMatch(rebuilt, /no people visible/);
  const preservingStale = buildStoryboardDetailPrompt(project, frame, [], '', template, true);
  assert.doesNotMatch(preservingStale, /no people visible/);
  const previouslyReady = buildStoryboardDetailPrompt(project, { ...frame, promptDetailStatus: 'ready' }, [], '', template);
  assert.doesNotMatch(previouslyReady, /no people visible/);
});

test('a newly selected reference is mandatory context even when the custom template omits references', () => {
  const project = { title: 'Чайка' };
  const frame = { id: 'frame_1', order: 1, scriptText: 'Чайка идёт по волнам',
    visualDescription: 'Чайка с казаками идёт по волнам', prompt: 'An empty boat',
    referenceIds: ['ref_cossacks'], promptDetailStatus: 'stale' };
  const references = [{ id: 'ref_cossacks', name: 'Казаки', type: 'character',
    description: 'Люди в исторической одежде', prompt: 'Cossacks on deck' }];
  const prompt = buildStoryboardDetailPrompt(project, frame, references, '', '{{FRAME}}');
  assert.match(prompt, /Cossacks on deck/);
  assert.match(prompt, /включай в сцену явно/);
  assert.doesNotMatch(prompt, /An empty boat/);
});

test('recognizes Gemini rate limits and uses provider retry hints', () => {
  assert.equal(isGeminiRateLimitError({ status: 429 }), true);
  assert.equal(isGeminiRateLimitError({ message: 'RESOURCE_EXHAUSTED: quota exceeded' }), true);
  assert.equal(isGeminiRateLimitError({ status: 500, message: 'Internal error' }), false);
  assert.equal(geminiRetryAfterMs({ message: 'Please retry in 23.5s' }), 23_500);
  assert.equal(geminiRetryAfterMs({ response: { headers: { get: () => '12' } } }), 12_000);
});
