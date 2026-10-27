import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Project from '../src/models/Project.js';
import VisualReference from '../src/models/VisualReference.js';
import StoryboardImage from '../src/models/StoryboardImage.js';
import StoryboardVideo from '../src/models/StoryboardVideo.js';
import ShortVideo from '../src/models/ShortVideo.js';
import StoryboardGeneration from '../src/models/StoryboardGeneration.js';
import Settings from '../src/models/Settings.js';
import { generatePlannedStoryboard } from '../src/services/storyboardService.js';

process.env.ENCRYPTION_KEY ||= 'project-copy-tests-only-32-characters';
const { default: router } = await import('../src/routes/projectRoutes.js');
const { storyboardGeneration } = await import('../src/services/storyboardGenerationService.js');
const { cloneProject, copyProjectName, remapProjectStorageKeys } = await import('../src/services/projectCloneService.js');
const { copyDriveProjectWorkspace } = await import('../src/services/driveSync.js');

const projectId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const invoke = async (routePath, body) => {
  const route = router.stack.find(layer => layer.route?.path === routePath && layer.route.methods.post).route;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await route.stack.at(-1).handle({ params: { id: projectId }, user: { _id: 'owner' }, body }, res);
  return res;
};

test('copy names are distinct and every stored media pointer is remapped', async () => {
  assert.equal(copyProjectName('Фильм', ['Фильм', 'Фильм (копия)']), 'Фильм (копия 2)');
  assert.equal(copyProjectName('Фильм (копия)', ['Фильм', 'Фильм (копия)']), 'Фильм (копия 2)');
  const oldId = new mongoose.Types.ObjectId();
  const original = { _id: oldId, voiceover: { blocks: [{ audioStorageKey: 'gdrive:old' }] },
    backgroundMusic: { storageKey: 'gdrive:old' }, frames: [{ storageKey: 'project/images/frame.jpg' }] };
  const clone = await remapProjectStorageKeys(original, async key => key === 'gdrive:old' ? 'gdrive:new' : key);
  assert.equal(clone._id, oldId);
  assert.equal(clone.voiceover.blocks[0].audioStorageKey, 'gdrive:new');
  assert.equal(clone.backgroundMusic.storageKey, 'gdrive:new');
  assert.equal(original.backgroundMusic.storageKey, 'gdrive:old');
});

test('Drive copy gives every media file its own ID in the new project folder', async () => {
  const files = new Map([
    ['source-root', [{ id: 'state', name: 'project_state.json', mimeType: 'application/json' },
      { id: 'source-images', name: 'images', mimeType: 'application/vnd.google-apps.folder' }]],
    ['source-images', [{ id: 'still', name: 'frame.jpg', mimeType: 'image/jpeg' }]],
  ]);
  const targets = [];
  const drive = { files: {
    list: async ({ q }) => ({ data: { files: files.get(q.match(/^'([^']+)'/)[1]) || [] } }),
    copy: async ({ fileId, requestBody }) => { targets.push(requestBody.parents[0]); return { data: { id: `copy-${fileId}` } }; },
  } };
  const ids = await copyDriveProjectWorkspace({ userId: 'owner', drive,
    sourceStorage: { driveRootFolderId: 'source-root', driveFolderIds: { images: 'source-images' } },
    targetStorage: { driveRootFolderId: 'target-root', driveFolderIds: { images: 'target-images' } } });
  assert.equal(ids.get('still'), 'copy-still');
  assert.equal(ids.get('state'), 'copy-state');
  assert.deepEqual(targets, ['target-root', 'target-images']);
});

test('local copy creates a separate workspace and media records while leaving the source untouched', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-copy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const oldRoot = process.env.PROJECTS_ROOT;
  process.env.PROJECTS_ROOT = root;
  t.after(() => { if (oldRoot === undefined) delete process.env.PROJECTS_ROOT; else process.env.PROJECTS_ROOT = oldRoot; });
  const sourcePath = path.join(root, 'Original');
  await fs.mkdir(path.join(sourcePath, 'images'), { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'images', 'frame.jpg'), 'frame bytes');
  const sourceId = new mongoose.Types.ObjectId();
  const source = { _id: sourceId, userId: 'owner', title: 'Фильм', shortTitle: 'Фильм',
    projectPath: sourcePath, storage: { provider: 'local' }, createdAt: new Date(0), updatedAt: new Date(0) };
  let copiedProject;
  let copiedImage;
  t.mock.method(Project.collection, 'findOne', async () => source);
  t.mock.method(Project.collection, 'find', () => ({ toArray: async () => [{ title: 'Фильм', shortTitle: 'Фильм' }] }));
  t.mock.method(Project.collection, 'insertOne', async doc => { copiedProject = doc; });
  t.mock.method(StoryboardGeneration.collection, 'findOne', async () => null);
  for (const Model of [VisualReference, StoryboardVideo, ShortVideo, StoryboardGeneration]) {
    t.mock.method(Model.collection, 'find', () => ({ toArray: async () => [] }));
  }
  t.mock.method(StoryboardImage.collection, 'find', () => ({ toArray: async () => [{
    _id: new mongoose.Types.ObjectId(), projectId: sourceId, userId: 'owner', frameId: 'frame',
    storageKey: 'project/images/frame.jpg', status: 'ready',
  }] }));
  t.mock.method(StoryboardImage.collection, 'insertMany', async docs => { copiedImage = docs[0]; });
  const copy = await cloneProject(sourceId.toString(), 'owner');
  assert.equal(copy.title, 'Фильм (копия)');
  assert.notEqual(copiedProject._id.toString(), sourceId.toString());
  assert.notEqual(copiedProject.projectPath, sourcePath);
  assert.equal(copiedImage.projectId.toString(), copy.projectId.toString());
  assert.equal(copiedImage.storageKey, 'project/images/frame.jpg');
  assert.equal(await fs.readFile(path.join(copiedProject.projectPath, 'images', 'frame.jpg'), 'utf8'), 'frame bytes');
  assert.equal(await fs.readFile(path.join(sourcePath, 'images', 'frame.jpg'), 'utf8'), 'frame bytes');
});

test('a project can skip references and start storyboard generation with an empty reference set', async t => {
  const project = { _id: projectId, userId: 'owner', title: 'Film',
    script: { status: 'confirmed', revision: 1, content: 'Story' },
    voiceover: { status: 'confirmed', revision: 1, sourceScriptRevision: 1,
      blocks: [{ id: 'block', order: 1, adaptedText: 'one two three four five six seven eight nine ten' }] },
    referencePlan: undefined };
  t.mock.method(Project, 'findOne', async () => project);
  t.mock.method(Project, 'findOneAndUpdate', async (_filter, update) => {
    project.referencePlan = update.$set.referencePlan;
    return project;
  });
  t.mock.method(VisualReference, 'find', async () => []);
  const skipped = await invoke('/:id/reference-plan/skip', { expectedEditVersion: 0, sourceScriptRevision: 1 });
  assert.equal(skipped.statusCode, 200);
  assert.equal(skipped.body.referencePlan.status, 'confirmed');
  assert.deepEqual(skipped.body.referencePlan.items, []);
  t.mock.method(Settings, 'findOne', async () => ({}));
  t.mock.method(storyboardGeneration, 'enqueue', async () => ({ runId: 'run', status: 'queued' }));
  const started = await invoke('/:id/storyboard/generate', { instructions: '', frames: [], expectedEditVersion: 0,
    sourceScriptRevision: 1, sourceReferencePlanRevision: 1, sourceVoiceoverRevision: 1 });
  assert.equal(started.statusCode, 202);
  assert.equal(started.body.generation.status, 'queued');
  const frames = await generatePlannedStoryboard([{ slot: '1', sourceVoiceoverBlockId: 'block', scriptText: 'one two' }],
    new Set(), async () => JSON.stringify({ frames: [{ slot: '1', visualDescription: 'Scene', prompt: 'Image', referenceIds: [] }] }));
  assert.deepEqual(JSON.parse(frames).frames[0].referenceIds, []);
});
