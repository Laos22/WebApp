import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { measureMp3Duration, inspectAudioBlock } from '../src/services/audioDuration.js';

// MPEG-1 Layer III, mono, 48 kHz, 1152 samples per frame. Zero side-info
// describes silent granules. Vary bitrate to force a full scan without Xing.
function mp3(vbr = false) {
  return Buffer.concat(Array.from({ length: 100 }, (_, i) => {
    const [index, bitrate] = vbr ? [[7, 96], [9, 128], [10, 160]][i % 3] : [9, 128];
    const frame = Buffer.alloc(3 * bitrate);
    frame.set([0xff, 0xfb, (index << 4) | 4, 0xc0]);
    return frame;
  }));
}

for (const vbr of [false, true]) test(`measures real MPEG frames (${vbr ? 'VBR without Xing' : 'CBR'}) without ffmpeg`, async () => {
  assert.ok(Math.abs(await measureMp3Duration(mp3(vbr)) - 2.4) < 1e-9);
});
test('invalid MP3 is not assigned a fabricated duration', async () => {
  await assert.rejects(measureMp3Duration(Buffer.from('not an MP3')));
});
test('legacy local MP3 is read and duration persisted; cached duration still checks availability', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'davinci-audio-'));
  try {
    const file = path.join(directory, 'legacy.mp3');
    await writeFile(file, mp3(true));
    const block = { id: 'old', audioStorageKey: file };
    const writes = [];
    const dependencies = { read: readFile, persist: async (source, duration) => writes.push([source.id, duration]) };
    assert.deepEqual(await inspectAudioBlock(block, dependencies), { available: true, exact: true, durationSec: 2.4 });
    assert.deepEqual(writes, [['old', 2.4]]);
    await inspectAudioBlock(block, dependencies);
    assert.equal(writes.length, 1);
    await rm(file);
    assert.deepEqual(await inspectAudioBlock(block, dependencies), { available: false });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('Drive storage key is passed unchanged; unreadable metadata falls back but DB errors propagate', async () => {
  const block = { audioStorageKey: 'gdrive:asset', id: 'old' };
  const read = async key => { assert.equal(key, block.audioStorageKey); return mp3(true); };
  await assert.rejects(inspectAudioBlock(block, { read, persist: async () => { throw new Error('DB unavailable'); } }), /DB unavailable/);
  assert.equal(block.audioDurationSec, undefined);
  assert.deepEqual(await inspectAudioBlock(block, { read: async () => Buffer.from('bad'), persist: () => assert.fail() }), { available: true, exact: false });
});
