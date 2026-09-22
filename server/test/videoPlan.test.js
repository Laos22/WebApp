import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Project from '../src/models/Project.js';
import StoryboardVideo from '../src/models/StoryboardVideo.js';
import StoryboardImage from '../src/models/StoryboardImage.js';
import { normalizeVideoPlan, patchVideoPlan, videoPlanResponse, videoInputFingerprint } from '../src/services/videoPlanService.js';
import { timelinePlan, TIMEBASE } from '../src/services/davinciXmlService.js';
import { storyboardVideoFilename, resolveStoryboardVideoStorageKey, saveStoryboardVideoFile,
  readStoryboardVideoFile, deleteStoryboardVideoFile, commitStoryboardVideoFile, rollbackStoryboardVideoFile } from '../src/services/storyboardVideoStorage.js';
import router from '../src/routes/videoRoutes.js';
import { ensureAuthenticated } from '../src/middleware/auth.js';
import { DEFAULT_VIDEO_PROMPT_PREPARATION_PROMPT } from '../src/models/Settings.js';
const id = '111111111111111111111111';
const fixture = () => ({ _id: id, title: 'Test', userId: 'owner',
  voiceover: { blocks: [{ id: 'b1', order: 2, audioDurationSec: 10.123, adaptedText: 'abcd' }] },
  storyboard: { revision: 3, editVersion: 4, status: 'confirmed', frames: [
    { id: 'f1', sourceVoiceoverBlockId: 'b1', scriptText: 'a', prompt: 'p', referenceIds: [] },
    { id: 'f2', sourceVoiceoverBlockId: 'b1', scriptText: 'bcd', prompt: 'p2', referenceIds: [] },
  ] } });
const patch = (frames = [{ frameId: 'f1', selected: true, videoPrompt: 'Move camera' }], expectedEditVersion = 0) => ({ frames, expectedEditVersion });

test('video plan schema defaults, enums, duplicate IDs and integer versions; video index', () => {
  const project = new Project({ videoPlan: { frames: [{ frameId: 'f1' }] } });
  assert.equal(project.videoPlan.status, 'empty');
  assert.equal(project.videoPlan.frames[0].selected, false);
  assert.equal(project.videoPlan.validateSync(), undefined);
  for (const value of [{ status: 'bad' }, { editVersion: 1.5 }, { revision: -1 },
    { frames: [{ frameId: 'a' }, { frameId: 'a' }] }, { frames: [{ frameId: 'a', promptStatus: 'bad' }] }]) {
    assert.ok(new Project({ videoPlan: value }).videoPlan.validateSync());
  }
  assert.ok(StoryboardVideo.schema.indexes().some(([keys, options]) =>
    options.unique && keys.userId === 1 && keys.projectId === 1 && keys.frameId === 1));
  const video = new StoryboardVideo({ userId: id, projectId: id, frameId: 'f1' });
  assert.equal(video.validateSync(), undefined);
  assert.equal(StoryboardVideo.schema.path('storageKey').options.select, false);
});

test('partial draft preserves other frames and stable IDs, rejects duplicate/unknown IDs and version conflicts', () => {
  const project = fixture();
  project.videoPlan = patchVideoPlan(project, patch([{ frameId: 'f2', selected: true, videoPrompt: 'Keep this' }]));
  const before = structuredClone(project.videoPlan.frames[1]);
  const result = patchVideoPlan(project, patch(undefined, 1));
  assert.deepEqual(result.frames[1], before);
  assert.deepEqual(result.frames.map(frame => frame.frameId), ['f1', 'f2']);
  assert.equal(result.frames[0].promptStatus, 'ready');
  assert.equal(result.editVersion, 2);
  assert.throws(() => patchVideoPlan(project, patch()), { code: 'VIDEO_PLAN_CONFLICT' });
  assert.throws(() => patchVideoPlan(project, patch([{ frameId: 'x', selected: false, videoPrompt: '' }], 1)), { code: 'UNKNOWN_FRAME_ID' });
  assert.throws(() => patchVideoPlan(project, patch([patch().frames[0], patch().frames[0]], 1)), { code: 'DUPLICATE_FRAME_ID' });
  assert.throws(() => patchVideoPlan(project, { ...patch(), status: 'confirmed' }), { code: 'INVALID_VIDEO_PLAN' });
  project.storyboard.revision++;
  assert.equal(normalizeVideoPlan(project).status, 'stale');
  project.storyboard.frames.shift();
  assert.deepEqual(normalizeVideoPlan(project).frames.map(frame => frame.frameId), ['f2']);
});

test('target durations use exact timeline algorithm, text fallback and structural errors', () => {
  const project = fixture();
  const response = videoPlanResponse(project);
  const expected = timelinePlan(project.voiceover.blocks, project.storyboard.frames).blocks[0].durations;
  assert.deepEqual(response.frames.map(frame => frame.targetDurationSec), expected.map(t => t / TIMEBASE));
  assert.equal(response.frames[0].blockNumber, 2);
  assert.equal(response.frames[1].frameInBlock, 2);
  assert.equal(response.frames[0].durationExact, true);
  project.voiceover.blocks[0].audioDurationSec = null;
  assert.equal(videoPlanResponse(project).frames[0].durationExact, false);
  project.storyboard.frames[0].sourceVoiceoverBlockId = 'unknown';
  assert.ok(videoPlanResponse(project).timingErrorCode);
});

test('fingerprints ignore unrelated storyboard revisions but detect source image/prompt/duration changes', () => {
  const project = fixture();
  const image = { frameId: 'f1', status: 'ready', storageKey: 'private', sourcePrompt: 'p', sourceReferenceIds: [], generatedAt: new Date(1) };
  const frame = project.storyboard.frames[0];
  const planFrame = normalizeVideoPlan(project).frames[0];
  const durationSec = videoPlanResponse(project).frames[0].targetDurationSec;
  const inputFingerprint = videoInputFingerprint({ frame, planFrame, image, durationSec });
  const video = { frameId: 'f1', status: 'ready', inputFingerprint, storageKey: 'secret', operationId: 'secret' };
  project.storyboard.revision++;
  project.storyboard.frames[1].prompt = 'unrelated change';
  const result = videoPlanResponse(project, [image], [video]);
  assert.equal(result.frames[0].video.status, 'ready');
  assert.ok(result.frames[0].previewUrl.includes('preview=1'));
  assert.equal(JSON.stringify(result).includes('secret'), false);
  image.updatedAt = new Date(5);
  assert.equal(videoPlanResponse(project, [image], [video]).frames[0].video.status, 'ready');
  image.generatedAt = new Date(2);
  assert.equal(videoPlanResponse(project, [image], [video]).frames[0].video.status, 'stale');
  for (const changes of [{ durationSec: 20 }, { planFrame: { videoPrompt: 'new' } }, { image: null }, { provider: 'new' }]) {
    assert.notEqual(videoInputFingerprint({ frame, planFrame, image, durationSec, ...changes }), inputFingerprint);
  }
});

test('stable video names, strict paths, local replacement rollback/commit and symlink safety', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-storage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { ...fixture(), projectPath: root };
  assert.equal(storyboardVideoFilename(project, 'f2'), 'video_2_2.mp4');
  assert.equal(storyboardVideoFilename(project, 'f2', 'v123'), 'video_2_2__v123.mp4');
  assert.equal(resolveStoryboardVideoStorageKey('project/video/video_2_2__v123.mp4', root), path.join(root, 'video/video_2_2__v123.mp4'));
  assert.throws(() => storyboardVideoFilename(project, '../x'));
  for (const key of ['../x', '/tmp/video_2_1.mp4', 'project/video/../images/x', 'project/video/video_0_1.mp4', 'project/video/video_2_1.mp4/extra', 'project/video/..\\x']) {
    assert.throws(() => resolveStoryboardVideoStorageKey(key, root), { code: 'INVALID_STORAGE_KEY' });
  }
  const buffer = Buffer.from('0000ftypisom0000');
  const save = data => saveStoryboardVideoFile({ project, frameId: 'f1', userId: id, buffer: data });
  let first = await save(buffer); await commitStoryboardVideoFile(first);
  const newer = Buffer.from('0000ftypisom1111');
  const next = await save(newer);
  assert.deepEqual(await readStoryboardVideoFile(next.storageKey, root), newer);
  await rollbackStoryboardVideoFile(next);
  assert.deepEqual(await readStoryboardVideoFile(first.storageKey, root), buffer);
  first = await save(newer); await commitStoryboardVideoFile(first);
  assert.deepEqual(await fs.readdir(path.join(root, 'video')), ['video_2_1.mp4']);
  await deleteStoryboardVideoFile(first.storageKey, root);
  await deleteStoryboardVideoFile(first.storageKey, root);
  const fresh = await save(buffer); await rollbackStoryboardVideoFile(fresh);
  assert.deepEqual(await fs.readdir(path.join(root, 'video')), []);
  await fs.writeFile(path.join(root, 'victim'), 'keep');
  await fs.symlink(path.join(root, 'victim'), path.join(root, 'video/video_2_1.mp4'));
  await assert.rejects(save(buffer), { code: 'INVALID_STORAGE_KEY' });
  await assert.rejects(readStoryboardVideoFile(first.storageKey, root), { code: 'INVALID_STORAGE_KEY' });
  await assert.rejects(deleteStoryboardVideoFile(first.storageKey, root), { code: 'INVALID_STORAGE_KEY' });
  assert.equal(await fs.readFile(path.join(root, 'victim'), 'utf8'), 'keep');
  await fs.rm(path.join(root, 'video'), { recursive: true });
  await fs.symlink(root, path.join(root, 'video'));
  await assert.rejects(save(buffer), { code: 'INVALID_STORAGE_KEY' });
});

async function request(method, body = patch()) {
  const route = router.stack.find(layer => layer.route?.methods[method]).route;
  assert.equal(route.stack[0].handle, ensureAuthenticated);
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } };
  await route.stack.at(-1).handle({ params: { id }, user: { _id: 'owner' }, body }, res);
  return res;
}
test('API ownership, unknown/duplicate frames, atomic version/source guards and one-frame save', async t => {
  let project = null;
  let writes = 0;
  t.mock.method(Project, 'findOne', filter => {
    assert.equal(filter.userId, 'owner'); assert.equal(filter._id, id);
    return { select: async () => project };
  });
  for (const method of ['get', 'patch']) assert.equal((await request(method)).code, 404);
  project = fixture();
  t.mock.method(StoryboardImage, 'find', () => ({ select: async () => [] }));
  t.mock.method(StoryboardVideo, 'find', async () => []);
  let conflict = false;
  t.mock.method(Project, 'findOneAndUpdate', (filter, update, options) => ({ select: async () => {
    writes++;
    assert.equal(filter.userId, 'owner'); assert.deepEqual(filter.storyboard, project.storyboard);
    assert.equal(options.runValidators, true);
    if (conflict) return null;
    if (project.videoPlan) assert.equal(filter['videoPlan.editVersion'], project.videoPlan.editVersion);
    else assert.deepEqual(filter.videoPlan, { $exists: false });
    project.videoPlan = update.$set.videoPlan; return project;
  } }));
  assert.equal((await request('get')).value.frames.length, 2);
  assert.equal((await request('patch', patch([{ frameId: 'unknown', selected: true, videoPrompt: '' }]))).code, 400);
  assert.equal((await request('patch', patch([patch().frames[0], patch().frames[0]]))).value.code, 'DUPLICATE_FRAME_ID');
  assert.equal(writes, 0);
  assert.equal((await request('patch')).code, 200);
  const savedFirst = structuredClone(project.videoPlan.frames[0]);
  assert.equal((await request('patch', patch([{ frameId: 'f2', selected: true, videoPrompt: 'Other' }], 1))).code, 200);
  assert.deepEqual(project.videoPlan.frames[0], savedFirst);
  assert.equal((await request('patch')).code, 409);
  conflict = true;
  assert.equal((await request('patch', patch(undefined, 2))).code, 409);
});

test('default preparation prompt contains all supported placeholders', () => {
  for (const key of ['PROJECT_TITLE', 'FRAME', 'FRAME_DURATION', 'IMAGE_PROMPT', 'REFERENCES', 'CURRENT_VIDEO_PROMPT', 'INSTRUCTIONS'])
    assert.ok(DEFAULT_VIDEO_PROMPT_PREPARATION_PROMPT.includes(`{{${key}}}`));
});


test('legacy MP3 duration is inspected by video endpoint without database writes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-duration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'audio'));
  const mp3Frame = Buffer.alloc(384); mp3Frame.set([0xff, 0xfb, 0x94, 0xc0]);
  await fs.writeFile(path.join(root, 'audio/audio_block_2.mp3'), Buffer.concat(Array(100).fill(mp3Frame)));
  const project = fixture(); project.projectPath = root;
  Object.assign(project.voiceover.blocks[0], { audioDurationSec: null, audioStatus: 'ready', audioStorageKey: 'project/audio/audio_block_2.mp3' });
  t.mock.method(Project, 'findOne', () => ({ select: async () => project }));
  t.mock.method(StoryboardImage, 'find', () => ({ select: async () => [] }));
  t.mock.method(StoryboardVideo, 'find', async () => []);
  const response = await request('get');
  assert.equal(response.code, 200);
  assert.equal(response.value.frames[0].durationExact, true);
  assert.equal(response.value.frames.reduce((sum, frame) => sum + frame.targetDurationSec, 0), 2.4);
});
