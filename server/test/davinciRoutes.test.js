import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Deliberately synthetic test configuration, never load .env or real credentials.
process.env.ENCRYPTION_KEY = 'davinci-test-only-configuration-00000000000000000000';
const { default: router } = await import('../src/routes/projectRoutes.js');
const { default: Project } = await import('../src/models/Project.js');
const { default: StoryboardImage } = await import('../src/models/StoryboardImage.js');

async function request(routePath, method, body = {}) {
  const route = router.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method]).route;
  const res = { code: 200, headers: {}, status(code) { this.code = code; return this; },
    json(value) { this.value = value; return this; }, send(value) { this.value = value; return this; },
    set(key, value) { this.headers[key] = value; return this; } };
  await route.stack.at(-1).handle({ params: { id: 'project' }, user: { _id: 'owner' }, body }, res);
  return res;
}

for (const legacy of [false, true]) test(`status and export with ${legacy ? 'legacy uploads and no projectPath' : 'project media'}; missing files disable export`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'davinci-routes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const oldProjectsRoot = process.env.PROJECTS_ROOT;
  process.env.PROJECTS_ROOT = root;
  t.after(() => { if (oldProjectsRoot === undefined) delete process.env.PROJECTS_ROOT; else process.env.PROJECTS_ROOT = oldProjectsRoot; });
  if (legacy) { await fs.mkdir(path.join(process.cwd(), 'uploads/voiceover'), { recursive: true }); await fs.mkdir(path.join(process.cwd(), 'uploads/storyboard-images'), { recursive: true }); }
  const legacyAudioDir = legacy ? await fs.mkdtemp(path.join(process.cwd(), 'uploads/voiceover/davinci-test-')) : null;
  const legacyImageDir = legacy ? await fs.mkdtemp(path.join(process.cwd(), 'uploads/storyboard-images/davinci-test-')) : null;
  if (legacy) t.after(async () => { await fs.rm(legacyAudioDir, { recursive: true, force: true }); await fs.rm(legacyImageDir, { recursive: true, force: true }); });
  const audioPath = path.join(legacyAudioDir || path.join(root, 'audio'), 'audio_block_1.mp3');
  const imagePath = path.join(legacyImageDir || path.join(root, 'images'), 'frame_1_1.jpg');
  await fs.mkdir(path.join(root, 'audio'));
  await fs.mkdir(path.join(root, 'images'));
  const mp3Frame = Buffer.alloc(384); mp3Frame.set([0xff, 0xfb, 0x94, 0xc0]);
  await fs.writeFile(audioPath, Buffer.concat(Array(100).fill(mp3Frame)));
  await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff]));
  const block = { id: 'b1', order: 1, textRevision: 1, adaptedText: 'Текст озвучки', audioStatus: 'ready', audioStorageKey: 'project/audio/audio_block_1.mp3' };
  const frame = { id: 'f1', order: 1, sourceVoiceoverBlockId: 'b1', scriptText: block.adaptedText, prompt: 'Original prompt', referenceIds: [], animation: 'Zoom In' };
  if (legacy) block.audioStorageKey = path.relative(path.join(process.cwd(), 'uploads'), audioPath);
  const project = { _id: '111111111111111111111111', shortTitle: 'Тест & проект', projectPath: legacy ? '' : root,
    script: { status: 'confirmed', revision: 1 }, referencePlan: { status: 'confirmed', revision: 1 },
    voiceover: { status: 'confirmed', revision: 1, blocks: [block] },
    storyboard: { status: 'confirmed', sourceScriptRevision: 1, sourceReferencePlanRevision: 1, sourceVoiceoverRevision: 1, frames: [frame] } };
  const image = { frameId: frame.id, status: 'ready', storageKey: 'project/images/frame_1_1.jpg', mimeType: 'image/jpeg', sourcePrompt: frame.prompt, sourceReferenceIds: [] };
  if (legacy) image.storageKey = path.relative(path.join(process.cwd(), 'uploads'), imagePath);
  t.mock.method(Project, 'findOne', () => ({ select: async () => project }));
  t.mock.method(StoryboardImage, 'find', () => ({ select: async () => [image] }));
  const writes = [];
  t.mock.method(Project, 'updateOne', async (filter, update) => { writes.push({ filter, update }); return { matchedCount: 1 }; });
  const status = await request('/:id/davinci', 'get');
  assert.equal(status.code, 200);
  assert.equal(status.value.canExport, true);
  assert.equal(status.value.audioTimings[0].durationSec, 2.4);
  assert.equal(writes[0].update.$set['voiceover.blocks.$.audioDurationSec'], 2.4);
  assert.equal(writes[0].filter.userId, 'owner');
  assert.equal(writes[0].filter['voiceover.blocks'].$elemMatch.audioStorageKey, block.audioStorageKey);
  const exported = await request('/:id/davinci/export', 'post', { frameRate: 25, addAnimations: true, addTransitions: false });
  assert.equal(exported.code, 200);
  assert.equal(exported.value.success, true);
  assert.equal(exported.headers['Content-Disposition'], undefined);
  assert.equal(exported.value.pathMode, 'absolute');
  assert.equal(exported.value.mediaRootPath, project.projectPath);
  const exportedXml = await fs.readFile(path.join(project.projectPath, exported.value.filename), 'utf8');
  assert.match(exportedXml, /adjust-transform/);
  for (const [, url] of exportedXml.matchAll(/src="([^"]+)"/g)) {
    assert.ok(url.startsWith('file:///'));
    await fs.access(fileURLToPath(url));
  }
  assert.equal(writes.length, legacy ? 2 : 1);
  if (legacy) {
    assert.deepEqual(writes[1].update, { $set: { projectPath: project.projectPath } });
    assert.equal(writes[1].filter.userId, 'owner');
    const stillUrl = exportedXml.match(/src="([^"]+\/still_[a-p]+\.jpg)"/)[1];
    assert.deepEqual(await fs.readFile(fileURLToPath(stillUrl)), await fs.readFile(imagePath));
    assert.deepEqual(await fs.readFile(path.join(project.projectPath, 'audio/audio_block_1.mp3')), await fs.readFile(audioPath));
    assert.match(image.storageKey, /^storyboard-images\//);
    assert.match(block.audioStorageKey, /^voiceover\//);
    assert.equal((await request('/:id/davinci/export', 'post')).code, 200);
    assert.equal(writes.length, 2);
  }
  const trimmed = await request('/:id/davinci/export', 'post', {
    audioTrim: { enabled: true, mode: 'seconds', startSec: 0.25, endSec: 0.5 },
  });
  assert.equal(trimmed.code, 200);
  const trimmedXml = await fs.readFile(path.join(project.projectPath, trimmed.value.filename), 'utf8');
  assert.match(trimmedXml, /lane="-1" start="8820000\/35280000s" offset="8820000\/35280000s" duration="58212000\/35280000s"/);
  assert.match(trimmedXml, /src="file:\/\/\/[^"]+\/images\/still_[a-p]{64}\.jpg"/);
  assert.match(trimmedXml, /<asset-clip name="frame_1_1.jpg"/);
  assert.equal((await request('/:id/davinci/export', 'post', {
    audioTrim: { enabled: true, mode: 'seconds', startSec: 20 },
  })).code, 400);
  const relative = await request('/:id/davinci/export', 'post', { pathMode: 'relative', mediaRootPath: 'invalid leftover hidden input' });
  assert.equal(relative.code, 200);
  assert.match(await fs.readFile(path.join(project.projectPath, relative.value.filename), 'utf8'), /src="images\/still_/);
  const custom = await request('/:id/davinci/export', 'post', { mediaRootPath: "'/Volumes/Resolve media'" });
  assert.equal(custom.code, 200);
  const customXml = await fs.readFile(path.join(project.projectPath, custom.value.filename), 'utf8');
  assert.match(customXml, /src="file:\/\/\/Volumes\/Resolve%20media\/images\//);
  assert.equal(project.projectPath === '/Volumes/Resolve media', false);
  project.storage = { provider: 'google_drive' };
  assert.equal((await request('/:id/davinci/export', 'post')).value.code, 'DAVINCI_MEDIA_ROOT_REQUIRED');
  delete project.storage;
  assert.equal((await request('/:id/davinci/export', 'post', { mediaRootPath: 'relative/path' })).code, 400);
  assert.equal(frame.prompt, 'Original prompt');
  await fs.unlink(imagePath);
  const missing = await request('/:id/davinci', 'get');
  assert.equal(missing.value.canExport, false);
  assert.equal(missing.value.readyImages, 0);
  assert.equal((await request('/:id/davinci/export', 'post')).code, 409);
  await fs.unlink(audioPath);
  assert.equal((await request('/:id/davinci', 'get')).value.readyAudio, 0);
  assert.equal((await request('/:id/davinci/export', 'post', { addTransitions: 'true' })).code, 400);
});

test('legacy MongoDB subdocuments accept absent duration, animation and marker without migration', () => {
  const project = new Project({ voiceover: { blocks: [{ id: 'old', order: 1, adaptedText: 'Text' }] },
    storyboard: { frames: [{ id: 'frame', order: 1, sourceVoiceoverBlockId: 'old', scriptText: 'Text', prompt: 'Keep', visualDescription: 'Keep' }] } });
  assert.equal(project.voiceover.blocks[0].audioDurationSec, null);
  assert.equal(project.storyboard.frames[0].animation, '');
  assert.equal(project.storyboard.frames[0].marker, '');
  assert.equal(project.storyboard.frames[0].validateSync(), undefined);
});
