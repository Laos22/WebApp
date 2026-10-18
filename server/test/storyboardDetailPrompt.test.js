import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY ||= 'test-encryption-key-that-is-longer-than-32-characters';

const {
  buildStoryboardDetailPrompt, geminiRetryAfterMs, isGeminiRateLimitError,
} = await import('../src/services/geminiService.js');

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

test('recognizes Gemini rate limits and uses provider retry hints', () => {
  assert.equal(isGeminiRateLimitError({ status: 429 }), true);
  assert.equal(isGeminiRateLimitError({ message: 'RESOURCE_EXHAUSTED: quota exceeded' }), true);
  assert.equal(isGeminiRateLimitError({ status: 500, message: 'Internal error' }), false);
  assert.equal(geminiRetryAfterMs({ message: 'Please retry in 23.5s' }), 23_500);
  assert.equal(geminiRetryAfterMs({ response: { headers: { get: () => '12' } } }), 12_000);
});
