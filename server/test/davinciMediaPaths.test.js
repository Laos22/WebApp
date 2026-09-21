import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { normalizeMediaRoot, mediaSourceUrl } from '../../shared/davinciMediaPaths.js';
import { createDavinciXml } from '../src/services/davinciXmlService.js';
import { prepareDavinciImages, saveDavinciStill } from '../src/services/davinciMediaStorage.js';

test('Drive still uploads request reuse of content-addressed copies', async () => {
  let request;
  await saveDavinciStill({ project: { storage: { provider: 'google_drive', driveFolderIds: { images: 'folder' } } },
    userId: 'user', buffer: Buffer.from('image'), extension: 'jpg', mimeType: 'image/jpeg',
    remoteWrite: async value => { request = value; } });
  assert.equal(request.reuseExisting, true);
});

test('image preparation bounds concurrency and preserves frame associations', async () => {
  let active = 0;
  let peak = 0;
  const progress = [];
  const frames = Array.from({ length: 41 }, (_, id) => ({ id }));
  const results = await prepareDavinciImages(frames, async frame => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return `still-${frame.id}`;
  }, completed => progress.push(completed));
  assert.equal(peak, 4);
  assert.equal(results.size, 41);
  frames.forEach(frame => assert.equal(results.get(frame.id), `still-${frame.id}`));
  assert.deepEqual(progress, Array.from({ length: 41 }, (_, i) => i + 1));
});

test('preparation stops scheduling on failure and waits for active workers', async () => {
  let started = 0;
  let finished = 0;
  await assert.rejects(prepareDavinciImages(Array.from({ length: 41 }, (_, id) => ({ id })), async frame => {
    started++;
    if (!frame.id) throw new Error('Drive timeout');
    await new Promise(resolve => setImmediate(resolve));
    finished++;
  }), /Drive timeout/);
  assert.equal(started, 4);
  assert.equal(finished, 3);
});

test('absolute file URLs round-trip spaces, Cyrillic and reserved characters', () => {
  const root = '/Users/editor/Проект & тест #100% ?';
  const url = mediaSourceUrl(root, 'images/frame_1_1.jpg');
  assert.equal(fileURLToPath(url), `${root}/images/frame_1_1.jpg`);
  assert.match(url, /^file:\/\/\//);
  assert.ok(url.includes('%20') && url.includes('%23') && url.includes('%25') && url.includes('%3F'));
  assert.equal(new URL(url).search, '');
  assert.equal(new URL(url).hash, '');
});
test('pasted paths accept paired quotes and preserve internal apostrophes', () => {
  for (const quote of ["'", '"']) {
    const root = '/Users/editor/Мой диск/Project';
    assert.equal(normalizeMediaRoot(` ${quote}${root}${quote} `), root);
    assert.equal(fileURLToPath(mediaSourceUrl(`${quote}${root}${quote}`, 'audio/test.mp3')), `${root}/audio/test.mp3`);
  }
  assert.equal(normalizeMediaRoot("/Users/editor/Editor's project"), "/Users/editor/Editor's project");
  assert.throws(() => normalizeMediaRoot("'/Users/editor/Project"), { code: 'INVALID_DAVINCI_MEDIA_ROOT' });
});
test('Windows and UNC desktop paths work on a non-Windows export server', () => {
  assert.equal(mediaSourceUrl('D:\\Projects\\My film', 'audio/audio_block_1.mp3'), 'file:///D:/Projects/My%20film/audio/audio_block_1.mp3');
  assert.equal(mediaSourceUrl('\\\\studio\\media\\My film', 'images/frame_1_1.jpg'), 'file://studio/media/My%20film/images/frame_1_1.jpg');
  assert.equal(normalizeMediaRoot('/Volumes/Media/Project///'), '/Volumes/Media/Project');
});
test('relative mode stays portable; URL and relative root inputs are rejected', () => {
  assert.equal(mediaSourceUrl('', 'images/frame_1_1.jpg'), 'images/frame_1_1.jpg');
  for (const value of [null, 1, '', 'relative/path', '~/Projects', 'https://example.test', 'file:///Users/test', '/Users/../test', '/tmp/\u0000file']) {
    assert.throws(() => normalizeMediaRoot(value), { code: 'INVALID_DAVINCI_MEDIA_ROOT' });
  }
});
test('XML applies the desktop root to both media types without exposing server paths', () => {
  const xml = createDavinciXml({
    projectName: 'Paths', frames: [{ id: 'f', sourceVoiceoverBlockId: 'b', scriptText: 'text' }],
    voiceoverBlocks: [{ id: 'b', order: 1, audioDurationSec: 4 }],
    imageFiles: new Map([['f', 'frame_1_1.jpg']]), mediaRootPath: '/Users/editor/Project',
  });
  assert.match(xml, /src="file:\/\/\/Users\/editor\/Project\/images\/frame_1_1.jpg"/);
  assert.match(xml, /src="file:\/\/\/Users\/editor\/Project\/audio\/audio_block_1.mp3"/);
  assert.doesNotMatch(xml, /\/opt\/render|\/tmp\//);
});
