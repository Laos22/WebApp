import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAdaptedBlocks, splitScenarioBlocks, validateManualVoiceoverBlocks,
} from '../src/services/voiceoverService.js';

test('scenario headings define a stable one-to-one voiceover structure', () => {
  const blocks = splitScenarioBlocks('Блок 1 Вступление\nДИКТОР: Первый текст.\n\nБлок 2 Финал\nДИКТОР: Второй текст.');
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map(block => block.sourceId), ['script_block_1', 'script_block_2']);
  const adapted = parseAdaptedBlocks(JSON.stringify({ blocks: [
    { id: 'script_block_1', adaptedText: 'Первый текст.' },
    { id: 'script_block_2', adaptedText: 'Второй текст.' },
  ] }), blocks);
  assert.equal(adapted.length, 2);
  assert.equal(adapted[1].order, 2);
});

test('AI cannot change the number or identity of voiceover blocks', () => {
  const blocks = splitScenarioBlocks('Блок 1\nОдин.\n\nБлок 2\nДва.');
  assert.throws(() => parseAdaptedBlocks(JSON.stringify({ blocks: [
    { id: 'script_block_1', adaptedText: 'Всё вместе.' },
  ] }), blocks), error => error.code === 'AUDIO_BLOCK_COUNT_MISMATCH');
  assert.throws(() => parseAdaptedBlocks(JSON.stringify({ blocks: [
    { id: 'script_block_1', adaptedText: 'Один.' },
    { id: 'script_block_3', adaptedText: 'Два.' },
  ] }), blocks), error => error.code === 'INVALID_AUDIO_ADAPTATION_RESPONSE');
});

test('manual block edit makes ready audio stale and increments text revision', () => {
  const current = [{
    id: 'voice_block_11111111-1111-4111-8111-111111111111', order: 1,
    sourceTitle: 'Блок 1', sourceText: 'Исходник', adaptedText: 'Старый текст',
    textRevision: 2, audioStatus: 'ready', audioStorageKey: 'voiceover/file.mp3',
  }];
  const updated = validateManualVoiceoverBlocks([{ id: current[0].id, adaptedText: 'Новый текст' }], current);
  assert.equal(updated[0].textRevision, 3);
  assert.equal(updated[0].audioStatus, 'stale');
});
