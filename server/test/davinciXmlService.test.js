import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDavinciXml } from '../src/services/davinciXmlService.js';

test('creates portable Resolve FCPXML with project media paths', () => {
  const block = { id: 'voice_1', order: 1, adaptedText: 'Текст первого блока для озвучки' };
  const frames = [
    { id: 'frame_1', sourceVoiceoverBlockId: block.id, scriptText: 'Текст первого' },
    { id: 'frame_2', sourceVoiceoverBlockId: block.id, scriptText: 'блока для озвучки' },
  ];
  const xml = createDavinciXml({
    projectName: 'Проект & тест', frames, voiceoverBlocks: [block],
    imageFiles: new Map([['frame_1', 'frame_1_1.jpg'], ['frame_2', 'frame_1_2.png']]),
  });
  assert.match(xml, /<fcpxml version="1\.9">/);
  assert.match(xml, /src="audio\/audio_block_1\.mp3"/);
  assert.match(xml, /src="images\/frame_1_1\.jpg"/);
  assert.match(xml, /src="images\/frame_1_2\.png"/);
  assert.match(xml, /Проект &amp; тест/);
  assert.equal((xml.match(/note="Voiceover Text"/g) || []).length, 2);
});
