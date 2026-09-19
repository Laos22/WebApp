import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY ||= 'test-encryption-key-that-is-longer-than-32-characters';

const { buildStoryboardDetailPrompt } = await import('../src/services/geminiService.js');

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
  );
  assert.match(result, /Тестовый проект/);
  assert.match(result, /Точный текст кадра/);
  assert.match(result, /ref_selected/);
  assert.doesNotMatch(result, /ref_unused/);
  assert.match(result, /Current prompt/);
  assert.match(result, /Больше деталей света/);
});
