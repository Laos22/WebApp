import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.ENCRYPTION_KEY ||= 'voiceover-upload-test-key-longer-than-32-chars';
const { default: router } = await import('../src/routes/projectRoutes.js');
const { default: Project } = await import('../src/models/Project.js');

const route = router.stack.find(layer => layer.route?.path === '/:id/voiceover/blocks/:blockId/audio' && layer.route.methods.post).route;

function mp3() {
  return Buffer.concat(Array.from({ length: 100 }, () => {
    const frame = Buffer.alloc(384);
    frame.set([0xff, 0xfb, 0x94, 0xc0]);
    return frame;
  }));
}

async function upload(project, buffer, name = 'generated.mp3') {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } };
  await route.stack.at(-1).handle({
    params: { id: project._id, blockId: 'b1' }, user: { _id: 'owner' },
    body: { expectedEditVersion: '2', textRevision: '1' },
    file: { buffer, originalname: name, mimetype: 'audio/mpeg' },
  }, res);
  return res;
}

test('uploaded MP3 replaces only its block after validation and keeps the audio readable', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voiceover-upload-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = path.join(root, 'audio', 'audio_block_1.mp3');
  await mkdir(path.dirname(old), { recursive: true });
  await writeFile(old, mp3());
  const block = { id: 'b1', order: 1, textRevision: 1, adaptedText: 'Текст', audioStatus: 'ready', audioStorageKey: 'project/audio/audio_block_1.mp3' };
  const other = { id: 'b2', order: 2, textRevision: 1, adaptedText: 'Другой блок', audioStatus: 'ready', audioStorageKey: 'project/audio/audio_block_2.mp3' };
  const project = { _id: '111111111111111111111111', projectPath: root,
    script: { status: 'confirmed', revision: 1 },
    voiceover: { status: 'confirmed', editVersion: 2, sourceScriptRevision: 1, blocks: [block, other] } };
  t.mock.method(Project, 'findOne', () => ({ select: async () => project }));
  t.mock.method(Project, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter['voiceover.editVersion'], 2);
    assert.equal(filter['voiceover.blocks'].$elemMatch.id, 'b1');
    assert.ok(update.$set['voiceover.blocks.$[block].audioStorageKey'].includes('audio_block_1_'));
    for (const [key, value] of Object.entries(update.$set)) {
      if (key.startsWith('voiceover.blocks.$[block].')) block[key.split('.').at(-1)] = value;
    }
    project.voiceover.editVersion += 1;
    return project;
  });
  const result = await upload(project, mp3());
  assert.equal(result.statusCode, 200);
  assert.equal(result.value.voiceover.blocks[0].audioStatus, 'ready');
  assert.ok(Math.abs(result.value.voiceover.blocks[0].audioDurationSec - 2.4) < 1e-9);
  assert.equal(other.audioStorageKey, 'project/audio/audio_block_2.mp3');
  assert.deepEqual(await readFile(path.join(root, 'audio', path.basename(block.audioStorageKey))), mp3());
});

test('invalid MP3 does not replace existing block audio', async t => {
  const oldKey = 'project/audio/audio_block_1.mp3';
  const project = { _id: '111111111111111111111111', voiceover: { blocks: [{ id: 'b1', audioStorageKey: oldKey }] } };
  t.mock.method(Project, 'findOne', () => { assert.fail('Invalid file should not reach the database'); });
  const result = await upload(project, Buffer.from('not an MP3'));
  assert.equal(result.statusCode, 400);
  assert.equal(project.voiceover.blocks[0].audioStorageKey, oldKey);
});
