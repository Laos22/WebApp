import { after, test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureProjectWorkspace, PROJECT_MEDIA_DIRECTORIES, projectStorageKey,
  resolveProjectStorageKey, safeProjectFolderName,
} from "../src/services/projectStorage.js";
import {
  commitStoryboardImageFile, deleteStoryboardImageFile, readStoryboardImageFile,
  rollbackStoryboardImageFile, saveStoryboardImageFile,
  storyboardFrameFileBase,
} from "../src/services/storyboardImageStorage.js";

const temporaryRoots = [];
after(async () => Promise.all(temporaryRoots.map(root => fs.rm(root, { recursive: true, force: true }))));

test("project workspace creates the expected media folders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webapp-project-"));
  temporaryRoots.push(root);
  await ensureProjectWorkspace(root);
  const entries = await fs.readdir(root);
  assert.deepEqual([...entries].sort(), [...PROJECT_MEDIA_DIRECTORIES].sort());
  assert.equal(safeProjectFolderName('../ Bad: project / name '), 'Bad project name');
});

test("project storage keys stay inside the selected project directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webapp-project-"));
  temporaryRoots.push(root);
  const key = projectStorageKey("images", "frame_1_1.jpg");
  assert.equal(key, "project/images/frame_1_1.jpg");
  assert.equal(resolveProjectStorageKey(root, key, "images"), path.join(root, "images", "frame_1_1.jpg"));
  assert.throws(() => resolveProjectStorageKey(root, "project/images/../../outside.jpg", "images"),
    error => error.code === "INVALID_STORAGE_KEY");
});

test("storyboard image uses block and frame-in-block filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webapp-project-"));
  temporaryRoots.push(root);
  const blockA = { id: "voice-a", order: 1 };
  const blockB = { id: "voice-b", order: 2 };
  const frames = [
    { id: "frame-a", sourceVoiceoverBlockId: blockA.id },
    { id: "frame-b", sourceVoiceoverBlockId: blockA.id },
    { id: "frame-c", sourceVoiceoverBlockId: blockB.id },
  ];
  const project = { voiceover: { blocks: [blockA, blockB] }, storyboard: { frames } };
  assert.equal(storyboardFrameFileBase(project, frames[1]), "frame_1_2");
  assert.equal(storyboardFrameFileBase(project, frames[2]), "frame_2_1");

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const saved = await saveStoryboardImageFile({
    projectPath: root, fileBaseName: "frame_1_2", buffer: pngHeader,
  });
  assert.equal(saved.storageKey, "project/images/frame_1_2.png");
  assert.deepEqual(await readStoryboardImageFile(saved.storageKey, root), pngHeader);

  await commitStoryboardImageFile(saved);
  const replacement = Buffer.concat([pngHeader, Buffer.from("new")]);
  const pendingReplacement = await saveStoryboardImageFile({
    projectPath: root, fileBaseName: "frame_1_2", buffer: replacement,
  });
  assert.deepEqual(await readStoryboardImageFile(pendingReplacement.storageKey, root), replacement);
  await rollbackStoryboardImageFile(pendingReplacement);
  assert.deepEqual(await readStoryboardImageFile(saved.storageKey, root), pngHeader);

  await deleteStoryboardImageFile(saved.storageKey, root);
  await assert.rejects(fs.access(path.join(root, "images", "frame_1_2.png")));
});

import { ensurePortableLocalFile } from '../src/services/davinciMediaStorage.js';
test('legacy media is copied under portable names without changing or overwriting originals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'davinci-portable-'));
  temporaryRoots.push(root);
  const buffer = Buffer.from('original MP3 bytes');
  await ensurePortableLocalFile(root, 'audio', 'audio_block_1.mp3', buffer);
  await ensurePortableLocalFile(root, 'audio', 'audio_block_1.mp3', buffer);
  await assert.rejects(ensurePortableLocalFile(root, 'audio', 'audio_block_1.mp3', Buffer.from('different')), { code: 'DAVINCI_MEDIA_NAME_CONFLICT' });
  assert.deepEqual(await fs.readFile(path.join(root, 'audio/audio_block_1.mp3')), buffer);
  assert.deepEqual(await fs.readdir(path.join(root, 'audio')), ['audio_block_1.mp3']);
  await assert.rejects(ensurePortableLocalFile(root, 'images', '../escape.jpg', buffer));
});

import { ensureDavinciLocalWorkspace } from '../src/services/davinciMediaStorage.js';
test('workspace initialization preserves Drive and existing project paths', async () => {
  const persist = () => assert.fail('Must not persist a new project root');
  const drive = { storage: { provider: 'google_drive' }, projectPath: '' };
  await ensureDavinciLocalWorkspace(drive, persist);
  assert.equal(drive.projectPath, '');
  const local = { projectPath: '/existing/project' };
  await ensureDavinciLocalWorkspace(local, persist);
  assert.equal(local.projectPath, '/existing/project');
});
test('failed workspace persistence does not report a saved project path', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'davinci-workspace-'));
  temporaryRoots.push(root);
  const previous = process.env.PROJECTS_ROOT;
  process.env.PROJECTS_ROOT = root;
  t.after(() => { if (previous === undefined) delete process.env.PROJECTS_ROOT; else process.env.PROJECTS_ROOT = previous; });
  const project = { _id: '111111111111111111111111', projectPath: '' };
  await assert.rejects(ensureDavinciLocalWorkspace(project, async () => { throw new Error('DB failed'); }), /DB failed/);
  assert.equal(project.projectPath, '');
});

import { davinciStillFilename, saveDavinciStill } from '../src/services/davinciMediaStorage.js';
test('Resolve export stills have no numeric sequences and do not overwrite source images', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'davinci-stills-'));
  temporaryRoots.push(root);
  const buffer = Buffer.from('original image');
  await ensurePortableLocalFile(root, 'images', 'frame_1_1.jpg', buffer);
  const input = { project: { projectPath: root }, buffer, extension: 'jpg', mimeType: 'image/jpeg' };
  const filename = await saveDavinciStill(input);
  assert.match(filename, /^still_[a-p]{64}\.jpg$/);
  assert.doesNotMatch(filename, /\d/);
  assert.equal(await saveDavinciStill(input), filename);
  assert.deepEqual(await fs.readFile(path.join(root, 'images', filename)), buffer);
  assert.deepEqual(await fs.readFile(path.join(root, 'images/frame_1_1.jpg')), buffer);
  assert.notEqual(davinciStillFilename(Buffer.from('different image'), 'jpg'), filename);
  for (const ext of ['jpg', 'png', 'webp']) assert.ok(davinciStillFilename(buffer, ext).endsWith(`.${ext}`));
});
test('Drive still copies use the images folder and preserve original bytes', async () => {
  const buffer = Buffer.from('image');
  const writes = [];
  const project = { storage: { provider: 'google_drive', driveFolderIds: { images: 'images-folder' } } };
  const input = { project, userId: 'owner', buffer, extension: 'png', mimeType: 'image/png', remoteWrite: async value => writes.push(value) };
  const filename = await saveDavinciStill(input);
  assert.deepEqual(writes, [{ userId: 'owner', parentId: 'images-folder', name: filename, mimeType: 'image/png', buffer, reuseExisting: true }]);
  assert.equal(project.projectPath, undefined);
});
