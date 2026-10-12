import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNarrationStats } from '../../client/src/utils/scriptNarration.js';

test('counts only narrator sections across Markdown script blocks', () => {
  const script = '### БЛОК 1: Вступление\n**ВІЗУАЛ:** Лес и камера.\n**ДИКТОР:**\nПривет, мир!\n\nЕщё текст.\n### БЛОК 2: Финал\nОписание блока\nДИКТОР: Пока!\nВИЗУАЛ: Затемнение.';
  assert.deepEqual(getNarrationStats(script), { characters: Array.from('Привет, мир! Ещё текст.Пока!').length, hasNarration: true });
});

test('handles alternate labels, Windows newlines and formatting', () => {
  assert.deepEqual(getNarrationStats('**ДИКТОР**: **Текст** тут.\r\n[ВІЗУАЛ]: Кадр\r\nДІКТОР:\r\nЩе текст.\r\n---\r\nИтог'), { characters: 'Текст тут.Ще текст.'.length, hasNarration: true });
});

test('does not present unmarked or visual-only scripts as narration', () => {
  for (const script of ['', 'Просто текст без меток', 'ВІЗУАЛ: Красивый пейзаж']) {
    assert.deepEqual(getNarrationStats(script), { characters: 0, hasNarration: false });
  }
  assert.deepEqual(getNarrationStats('ДИКТОР:'), { characters: 0, hasNarration: true });
});

test('recounts edited text, preserves punctuation and counts Unicode characters', () => {
  assert.equal(getNarrationStats('ДИКТОР: Привет!').characters, 7);
  assert.equal(getNarrationStats('ДИКТОР: Привет, мир! 🌍').characters, 14);
});
