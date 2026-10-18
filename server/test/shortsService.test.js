import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShortSuggestions, validateShortDraft } from '../src/services/shortsService.js';
import { createDavinciXml, frameDurations, TIMEBASE } from '../src/services/davinciXmlService.js';

const frames = [1, 2, 3].map(order => ({ id: `frame_${order}`, order, scriptText: `Текст ${order}` }));

test('short suggestions accept only known storyboard frames and preserve order', () => {
  const result = parseShortSuggestions(JSON.stringify({ suggestions: [{ title: 'История', hook: 'Начало',
    narration: 'Отдельный короткий текст', frameOrders: [3, 1, 2] }] }), frames);
  assert.deepEqual(result[0].shots.map(shot => shot.frameId), ['frame_3', 'frame_1', 'frame_2']);
  assert.equal(parseShortSuggestions(JSON.stringify({ suggestions: [{ title: 'История',
    narration: 'Текст', frameOrders: [3, 4] }] }), frames), null);
  assert.equal(validateShortDraft({ title: 'История', hook: '', narration: 'Текст',
    shots: [{ frameId: 'frame_1' }, { frameId: 'frame_1' }] }, new Set(frames.map(frame => frame.id))), null);
});

test('vertical XML uses selected shots, distinct narration, cropped media, and weighted durations', () => {
  const xml = createDavinciXml({ projectName: 'Шортс', outputWidth: 1080, outputHeight: 1920,
    frames: [
      { id: 'frame_1', sourceVoiceoverBlockId: 'short', durationWeight: 1, scriptText: 'Первый' },
      { id: 'frame_2', sourceVoiceoverBlockId: 'short', durationWeight: 2, scriptText: 'Второй' },
    ],
    voiceoverBlocks: [{ id: 'short', order: 1, adaptedText: 'Новый текст', audioDurationSec: 9,
      audioFilename: `short_${'a'.repeat(24)}_${'b'.repeat(32)}.mp3` }],
    imageFiles: new Map([['frame_1', 'frame_1_1.jpg'], ['frame_2', 'frame_1_2.jpg']]),
    videoFiles: new Map([['frame_2', { filename: 'video_1_2.mp4', durationSec: 4 }]]),
    horizontalOffsets: new Map([['frame_1', 30], ['frame_2', -30]]),
  });
  assert.match(xml, /width="1080" height="1920"/);
  assert.match(xml, /audio\/short_aaaaaaaaaaaaaaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\.mp3/);
  assert.match(xml, /video\/video_1_2\.mp4/);
  assert.equal((xml.match(/<adjust-conform type="fill"\/>/g) || []).length, 2);
  assert.match(xml, /position="30 0"/);
  assert.match(xml, /position="-30 0"/);
  assert.equal((xml.match(/<asset-clip name="frame_/g) || []).length, 2);
  assert.deepEqual(frameDurations([{ durationWeight: 1 }, { durationWeight: 2 }], 9 * TIMEBASE),
    [3 * TIMEBASE, 6 * TIMEBASE]);
});
