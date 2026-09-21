import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioTrimSeconds, validateAudioTrim } from '../../shared/davinciAudioTrim.js';
import { createDavinciXml, TIMEBASE } from '../src/services/davinciXmlService.js';

const phrase = '-Абзац-';
test('any word or phrase sets the character count without requiring a narration match', () => {
  const text = `${phrase} Текст ${phrase}`;
  const result = audioTrimSeconds(text, 20, { enabled: true });
  assert.equal(result.start, 20 * 7 / Array.from(text).length);
  assert.equal(result.end, result.start);
  assert.equal(result.approximate, true);
  const narration = 'Совершенно другой текст без служебного слова';
  const short = audioTrimSeconds(narration, 20, { enabled: true, phrase: 'Да' });
  const long = audioTrimSeconds(narration, 20, { enabled: true, phrase: 'Стоп' });
  assert.equal(short.start, 20 * 2 / Array.from(narration).length);
  assert.equal(short.end, short.start);
  assert.equal(long.start, short.start * 2);
  assert.equal(long.end, long.start);
  assert.throws(() => audioTrimSeconds('', 20, { enabled: true }), { code: 'INVALID_AUDIO_TRIM' });
});
test('edge whitespace and Unicode characters are counted consistently', () => {
  const text = `  ${phrase} 😀 текст ${phrase}\n`;
  const result = audioTrimSeconds(text, 30, { enabled: true });
  assert.equal(result.start, 30 * 7 / Array.from(text).length);
  assert.equal(result.end, result.start);
  assert.equal(audioTrimSeconds(text, 30, { enabled: true, phrase: ' 😀 ' }).start, 30 / Array.from(text).length);
});
test('seconds mode, disabled defaults and invalid/whole-block trims', () => {
  assert.deepEqual(audioTrimSeconds('text', 10), { start: 0, end: 0, approximate: false });
  assert.deepEqual(audioTrimSeconds('text', 10, { enabled: true, mode: 'seconds', startSec: 1, endSec: 2 }), { start: 1, end: 2, approximate: false });
  for (const value of [null, [], { enabled: 'yes' }, { startSec: -1 }, { endSec: Infinity }, { phrase: '' }, { mode: 'other' }, { startSec: 61 }, { extra: true }]) {
    assert.throws(() => validateAudioTrim(value), { code: 'INVALID_AUDIO_TRIM' });
  }
  assert.throws(() => audioTrimSeconds(phrase, 1, { enabled: true }), { code: 'INVALID_AUDIO_TRIM' });
  assert.throws(() => audioTrimSeconds('text', 3, { enabled: true, mode: 'seconds', startSec: 1, endSec: 2 }), { code: 'INVALID_AUDIO_TRIM' });
});
for (const fps of [24, 25, 30]) test(`audio trims preserve all video, transition and block positions at ${fps} FPS`, () => {
  const blocks = [1, 2].map(order => ({ id: `b${order}`, order, audioDurationSec: 10.123, adaptedText: `${phrase} Text ${phrase}` }));
  const frames = blocks.flatMap(block => [1, 2].map(i => ({ id: `${block.id}_${i}`, sourceVoiceoverBlockId: block.id, scriptText: 'Текст', animation: 'Pan Left' })));
  const input = { frames, voiceoverBlocks: blocks, frameRate: fps, addTransitions: true,
    imageFiles: new Map(frames.map((f, i) => [f.id, `frame_${Math.floor(i / 2) + 1}_${i % 2 + 1}.jpg`])) };
  const original = createDavinciXml(input);
  const trimmed = createDavinciXml({ ...input, audioTrim: { enabled: true, mode: 'seconds', startSec: 0.5, endSec: 0.75 } });
  const withoutAudioClips = xml => xml.replace(/<asset-clip[^>]+lane="-1"[^>]+\/>/g, '');
  assert.equal(withoutAudioClips(trimmed), withoutAudioClips(original));
  const audioClips = [...trimmed.matchAll(/<asset-clip[^>]+lane="-1"[^>]+\/>/g)];
  assert.equal(audioClips.length, 2);
  for (const [clip] of audioClips) {
    assert.ok(clip.includes(`start="${TIMEBASE / 2}/${TIMEBASE}s"`));
    assert.ok(clip.includes(`offset="${TIMEBASE / 2}/${TIMEBASE}s"`));
    assert.ok(clip.includes(`duration="${Math.round(10.123 * TIMEBASE) - TIMEBASE * 1.25}/${TIMEBASE}s"`));
  }
});
