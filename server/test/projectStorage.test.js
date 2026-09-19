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
