import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import StoryboardVideo from '../src/models/StoryboardVideo.js';
import StoryboardImage from '../src/models/StoryboardImage.js';
import Project from '../src/models/Project.js';
import { videoStorageGateway } from '../src/services/storyboardVideoStorage.js';
import {
  parseFlowVideoFilename,
  isSafeFilename,
  validateUploadedFilename,
  validateMp4Buffer,
} from '../src/services/flowVideoValidation.js';
import { importFlowVideoSingleFrame } from '../src/services/flowVideoImportService.js';
import { videoInputFingerprint } from '../src/services/videoPlanService.js';
import {
  createFixtureProject,
  createValidMp4Buffer,
  FIXTURE_PROJECT_ID,
  FIXTURE_USER_ID,
  FIXTURE_FRAME_ID_1,
  FIXTURE_FRAME_ID_2,
} from './helpers/flowVideoFixtures.js';

test('filename validation accepts contract pattern and safe arbitrary names, rejects traversal and dangerous characters', () => {
  const frameId = FIXTURE_FRAME_ID_1;
  const fp = 'a'.repeat(64);
  const contractFilename = `video_${frameId}__${fp}.mp4`;

  assert.deepEqual(parseFlowVideoFilename(contractFilename), {
    frameId,
    inputFingerprint: fp,
  });

  assert.equal(isSafeFilename(contractFilename), true);
  assert.equal(isSafeFilename('result.mp4'), true);
  assert.equal(isSafeFilename('my-video_01.mp4'), true);

  assert.equal(isSafeFilename('../danger.mp4'), false);
  assert.equal(isSafeFilename('/etc/video.mp4'), false);
  assert.equal(isSafeFilename('video\\sub.mp4'), false);
  assert.equal(isSafeFilename('video\0null.mp4'), false);
  assert.equal(isSafeFilename('C:video.mp4'), false);

  assert.ok(validateUploadedFilename(contractFilename, frameId, fp));
  assert.ok(validateUploadedFilename('arbitrary.mp4', frameId, fp));

  // Mismatched contract name must be rejected
  assert.throws(
    () => validateUploadedFilename(`video_${frameId}__${'b'.repeat(64)}.mp4`, frameId, fp),
    { code: 'INVALID_VIDEO_FILENAME' }
  );
  assert.throws(
    () => validateUploadedFilename(`video_${FIXTURE_FRAME_ID_2}__${fp}.mp4`, frameId, fp),
    { code: 'INVALID_VIDEO_FILENAME' }
  );
});

test('validateMp4Buffer parses valid ISO BMFF MP4 with v0 and v1 headers', () => {
  const v0Buffer = createValidMp4Buffer({ durationSec: 4.5, width: 1280, height: 720, mvhdVersion: 0 });
  const result0 = validateMp4Buffer(v0Buffer);
  assert.equal(result0.valid, true);
  assert.equal(result0.durationSec, 4.5);
  assert.equal(result0.width, 1280);
  assert.equal(result0.height, 720);

  const v1Buffer = createValidMp4Buffer({ durationSec: 7.2, width: 1920, height: 1080, mvhdVersion: 1 });
  const result1 = validateMp4Buffer(v1Buffer);
  assert.equal(result1.valid, true);
  assert.equal(result1.durationSec, 7.2);
  assert.equal(result1.width, 1920);
  assert.equal(result1.height, 1080);
});

test('validateMp4Buffer rejects truncated boxes, unsupported brands, corrupted nested boxes, and missing video track', () => {
  // Empty or non-buffer
  assert.throws(() => validateMp4Buffer(Buffer.alloc(8)), { code: 'INVALID_VIDEO_FILE' });

  // Valid mp4 truncated in the middle
  const valid = createValidMp4Buffer();
  assert.throws(() => validateMp4Buffer(valid.subarray(0, 50)), { code: 'INVALID_VIDEO_FILE' });

  // Missing mdat
  const noMdat = valid.subarray(0, valid.length - 40);
  assert.throws(() => validateMp4Buffer(noMdat), { code: 'INVALID_VIDEO_FILE' });

  // Unsupported brand (e.g. 'flv ')
  const badBrand = createValidMp4Buffer({ majorBrand: 'flv ', compatibleBrands: ['flv ', 'flv '] });
  assert.throws(() => validateMp4Buffer(badBrand), { code: 'INVALID_VIDEO_FILE' });

  // Corrupted nested box with invalid length extending past parent
  const corruptNested = Buffer.from(valid);
  // Locate moov and write corrupted box size inside moov
  const moovOffset = corruptNested.indexOf('moov') - 4;
  if (moovOffset >= 0) {
    corruptNested.writeUInt32BE(999999, moovOffset + 8); // corrupt first child size
    assert.throws(() => validateMp4Buffer(corruptNested), { code: 'INVALID_VIDEO_FILE' });
  }

  // Audio-only track (hdlr handler_type = 'soun')
  const audioOnly = Buffer.from(valid);
  const hdlrOffset = audioOnly.indexOf('vide');
  if (hdlrOffset >= 0) {
    audioOnly.write('soun', hdlrOffset, 'ascii');
    assert.throws(() => validateMp4Buffer(audioOnly), { code: 'INVALID_VIDEO_FILE' });
  }
});

test('importFlowVideoSingleFrame imports new video and performs atomic compare-and-swap replacement', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-import-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const project = createFixtureProject({ rootPath: root });
  const frameId = FIXTURE_FRAME_ID_1;

  const sourceImage = {
    _id: '607f1f77bcf86cd799439022',
    projectId: project._id,
    userId: project.userId,
    frameId,
    status: 'ready',
    storageKey: 'project/images/frame_1_1.png',
    sourcePrompt: project.storyboard.frames[0].prompt,
    sourceReferenceIds: [],
    generatedAt: new Date(1000),
    byteSize: 12345,
  };

  const expectedFingerprint = videoInputFingerprint({
    frame: project.storyboard.frames[0],
    planFrame: project.videoPlan.frames[0],
    image: sourceImage,
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  t.mock.method(Project, 'findOne', filter => {
    assert.equal(filter._id, FIXTURE_PROJECT_ID);
    assert.equal(filter.userId, FIXTURE_USER_ID);
    return { select: async () => project, then: fn => fn(project) };
  });

  t.mock.method(StoryboardImage, 'findOne', () => ({
    select: async () => sourceImage,
  }));

  let storedDbVideo = null;

  t.mock.method(StoryboardVideo, 'findOne', () => ({
    select: async () => storedDbVideo,
  }));

  t.mock.method(StoryboardVideo, 'create', async doc => {
    storedDbVideo = { ...doc, _id: 'video_doc_1', updatedAt: new Date() };
    return storedDbVideo;
  });

  t.mock.method(StoryboardVideo, 'findOneAndUpdate', (filter, update) => {
    if (!storedDbVideo || filter.updatedAt !== storedDbVideo.updatedAt || filter.storageKey !== storedDbVideo.storageKey) return null;
    storedDbVideo = { ...storedDbVideo, ...update.$set, updatedAt: new Date() };
    return storedDbVideo;
  });

  const mp4Buffer = createValidMp4Buffer({ durationSec: 5.0, width: 1920, height: 1080 });

  // 1. Initial Import
  const importResult = await importFlowVideoSingleFrame({
    project,
    userId: project.userId,
    frameId,
    inputFingerprint: expectedFingerprint,
    fileBuffer: mp4Buffer,
    uploadedFilename: `video_${frameId}__${expectedFingerprint}.mp4`,
  });

  assert.equal(importResult.success, true);
  assert.equal(importResult.result.outcome, 'imported');
  assert.equal(importResult.result.frameId, frameId);
  assert.equal(importResult.result.video.durationSec, 5.0);
  assert.equal(importResult.result.video.status, 'ready');

  // Verify file was written to root/video
  const files = await fs.readdir(path.join(root, 'video'));
  assert.equal(files.length, 1);
  const firstFile = files[0];

  // 2. Replacement Import with slight duration diff (produces warning)
  const replacementBuffer = createValidMp4Buffer({ durationSec: 4.2, width: 1920, height: 1080 });
  const replaceResult = await importFlowVideoSingleFrame({
    project,
    userId: project.userId,
    frameId,
    inputFingerprint: expectedFingerprint,
    fileBuffer: replacementBuffer,
    uploadedFilename: 'replacement.mp4',
  });

  assert.equal(replaceResult.success, true);
  assert.equal(replaceResult.result.outcome, 'replaced');
  assert.equal(replaceResult.result.video.durationSec, 4.2);
  assert.equal(replaceResult.result.warnings.length, 1);
  assert.ok(replaceResult.result.warnings[0].includes('отличается от целевой'));

  // Old file deleted, new file present
  const filesAfterReplace = await fs.readdir(path.join(root, 'video'));
  assert.equal(filesAfterReplace.length, 1);
  assert.notEqual(filesAfterReplace[0], firstFile);
});

test('importFlowVideoSingleFrame detects race condition during file write and deletes new file', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-race-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const project = createFixtureProject({ rootPath: root });
  const frameId = FIXTURE_FRAME_ID_1;

  const image = {
    _id: '607f1f77bcf86cd799439022',
    projectId: project._id,
    userId: project.userId,
    frameId,
    status: 'ready',
    storageKey: 'img',
    sourcePrompt: project.storyboard.frames[0].prompt,
    sourceReferenceIds: [],
    generatedAt: new Date(1000),
  };

  const expectedFingerprint = videoInputFingerprint({
    frame: project.storyboard.frames[0],
    planFrame: project.videoPlan.frames[0],
    image,
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  t.mock.method(Project, 'findOne', () => {
    const changed = structuredClone(project);
    changed.videoPlan.frames[0].videoPrompt = 'Изменённый промт в гонке';
    return { select: async () => changed, then: fn => fn(changed) };
  });

  t.mock.method(StoryboardImage, 'findOne', () => ({ select: async () => image }));
  t.mock.method(StoryboardVideo, 'findOne', () => ({ select: async () => null }));
  t.mock.method(StoryboardVideo, 'create', async doc => doc);

  const mp4Buffer = createValidMp4Buffer();
  await assert.rejects(
    importFlowVideoSingleFrame({
      project,
      userId: project.userId,
      frameId,
      inputFingerprint: expectedFingerprint,
      fileBuffer: mp4Buffer,
      uploadedFilename: 'test.mp4',
    }),
    { code: 'STALE_INPUT_FINGERPRINT' }
  );

  // New file must be cleaned up
  const files = await fs.readdir(path.join(root, 'video')).catch(() => []);
  assert.equal(files.length, 0);
});

test('importFlowVideoSingleFrame cleans up new file when CAS conflict occurs due to storageKey mismatch', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-cas-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const project = createFixtureProject({ rootPath: root });
  const frameId = FIXTURE_FRAME_ID_1;

  const image = {
    frameId, status: 'ready', storageKey: 'img', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date(),
  };
  t.mock.method(Project, 'findOne', () => ({ select: async () => project, then: fn => fn(project) }));
  t.mock.method(StoryboardImage, 'findOne', () => ({ select: async () => image }));

  const fingerprint = videoInputFingerprint({
    frame: project.storyboard.frames[0],
    planFrame: project.videoPlan.frames[0],
    image,
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  const existing = {
    _id: 'existing_id',
    updatedAt: new Date(100),
    storageKey: 'project/video/video_1_1__old_key.mp4',
  };
  t.mock.method(StoryboardVideo, 'findOne', () => ({ select: async () => existing }));

  // Simulate CAS failing because filter.storageKey did not match
  t.mock.method(StoryboardVideo, 'findOneAndUpdate', () => null);

  const mp4Buffer = createValidMp4Buffer();
  await assert.rejects(
    importFlowVideoSingleFrame({
      project,
      userId: project.userId,
      frameId,
      inputFingerprint: fingerprint,
      fileBuffer: mp4Buffer,
      uploadedFilename: 'test.mp4',
    }),
    { code: 'VIDEO_PLAN_CONFLICT' }
  );

  // Newly written file should have been cleaned up
  const files = await fs.readdir(path.join(root, 'video')).catch(() => []);
  assert.equal(files.length, 0);
});

test('importFlowVideoSingleFrame cleans up new file on initial insert conflict (11000)', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-insert-conflict-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const project = createFixtureProject({ rootPath: root });
  const frameId = FIXTURE_FRAME_ID_1;
  const image = {
    frameId, status: 'ready', storageKey: 'img', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date(),
  };
  t.mock.method(Project, 'findOne', () => ({ select: async () => project, then: fn => fn(project) }));
  t.mock.method(StoryboardImage, 'findOne', () => ({ select: async () => image }));
  t.mock.method(StoryboardVideo, 'findOne', () => ({ select: async () => null }));

  t.mock.method(StoryboardVideo, 'create', async () => {
    const err = new Error('E11000 duplicate key');
    err.code = 11000;
    throw err;
  });

  const fingerprint = videoInputFingerprint({
    frame: project.storyboard.frames[0],
    planFrame: project.videoPlan.frames[0],
    image,
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  const mp4Buffer = createValidMp4Buffer();
  await assert.rejects(
    importFlowVideoSingleFrame({
      project,
      userId: project.userId,
      frameId,
      inputFingerprint: fingerprint,
      fileBuffer: mp4Buffer,
      uploadedFilename: 'test.mp4',
    }),
    { code: 'VIDEO_PLAN_CONFLICT' }
  );

  const files = await fs.readdir(path.join(root, 'video')).catch(() => []);
  assert.equal(files.length, 0);
});

test('importFlowVideoSingleFrame succeeds even if deleting old file fails after DB commit', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-del-fail-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const project = createFixtureProject({ rootPath: root });
  const frameId = FIXTURE_FRAME_ID_1;

  const image = {
    frameId, status: 'ready', storageKey: 'img', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date(),
  };
  t.mock.method(Project, 'findOne', () => ({ select: async () => project, then: fn => fn(project) }));
  t.mock.method(StoryboardImage, 'findOne', () => ({ select: async () => image }));

  const fingerprint = videoInputFingerprint({
    frame: project.storyboard.frames[0],
    planFrame: project.videoPlan.frames[0],
    image,
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  const existing = {
    _id: 'existing_id',
    updatedAt: new Date(100),
    storageKey: 'project/video/video_non_existent.mp4',
  };
  t.mock.method(StoryboardVideo, 'findOne', () => ({ select: async () => existing }));
  t.mock.method(StoryboardVideo, 'findOneAndUpdate', (filter, update) => ({
    ...existing,
    ...update.$set,
    status: 'ready',
    durationSec: 5.0,
  }));

  const mp4Buffer = createValidMp4Buffer();
  const res = await importFlowVideoSingleFrame({
    project,
    userId: project.userId,
    frameId,
    inputFingerprint: fingerprint,
    fileBuffer: mp4Buffer,
    uploadedFilename: 'test.mp4',
  });

  assert.equal(res.success, true);
  assert.equal(res.result.outcome, 'replaced');
});

test('importFlowVideoSingleFrame uploads new video to Google Drive via mock gateway', async t => {
  const project = createFixtureProject();
  project.projectPath = '';
  project.storage = {
    provider: 'google_drive',
    driveRootFolderId: 'root_123',
    driveFolderIds: { video: 'video_folder_123' },
  };
  const frameId = FIXTURE_FRAME_ID_1;

  const image = {
    frameId, status: 'ready', storageKey: 'gdrive:img_123', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date(),
  };

  const fingerprint = videoInputFingerprint({
    frame: project.storyboard.frames[0],
    planFrame: project.videoPlan.frames[0],
    image,
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  t.mock.method(Project, 'findOne', () => ({ select: async () => project, then: fn => fn(project) }));
  t.mock.method(StoryboardImage, 'findOne', () => ({ select: async () => image }));
  t.mock.method(StoryboardVideo, 'findOne', () => ({ select: async () => null }));

  const savedAssets = [];
  t.mock.method(videoStorageGateway, 'saveProjectAsset', async args => {
    savedAssets.push(args);
    return {
      storageKey: 'gdrive:new_drive_video_1',
      filename: args.filename,
    };
  });

  const trashedAssets = [];
  t.mock.method(videoStorageGateway, 'deleteProjectAsset', async args => {
    trashedAssets.push(args);
    return true;
  });

  let createdDoc = null;
  t.mock.method(StoryboardVideo, 'create', async doc => {
    createdDoc = { ...doc, _id: 'db_video_1', updatedAt: new Date() };
    return createdDoc;
  });

  const mp4Buffer = createValidMp4Buffer();
  const res = await importFlowVideoSingleFrame({
    project,
    userId: project.userId,
    frameId,
    inputFingerprint: fingerprint,
    fileBuffer: mp4Buffer,
    uploadedFilename: 'drive_video.mp4',
  });

  assert.equal(res.success, true);
  assert.equal(res.result.outcome, 'imported');
  assert.equal(res.result.video.status, 'ready');
  assert.equal(savedAssets.length, 1);
  assert.equal(savedAssets[0].directory, 'video');
  assert.equal(createdDoc.storageKey, 'gdrive:new_drive_video_1');
  assert.equal(trashedAssets.length, 0);
});

test('importFlowVideoSingleFrame replaces existing video on Google Drive and trashes old file', async t => {
  const project = createFixtureProject();
  project.projectPath = '';
  project.storage = {
    provider: 'google_drive',
    driveRootFolderId: 'root_123',
    driveFolderIds: { video: 'video_folder_123' },
  };
  const frameId = FIXTURE_FRAME_ID_1;

  const image = {
    frameId, status: 'ready', storageKey: 'gdrive:img_123', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date(),
  };

  const fingerprint = videoInputFingerprint({
    frame: project.storyboard.frames[0],
    planFrame: project.videoPlan.frames[0],
    image,
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  const existing = {
    _id: 'existing_db_id',
    storageKey: 'gdrive:old_drive_video_1',
    updatedAt: new Date(100),
  };

  t.mock.method(Project, 'findOne', () => ({ select: async () => project, then: fn => fn(project) }));
  t.mock.method(StoryboardImage, 'findOne', () => ({ select: async () => image }));
  t.mock.method(StoryboardVideo, 'findOne', () => ({ select: async () => existing }));

  t.mock.method(videoStorageGateway, 'saveProjectAsset', async args => ({
    storageKey: 'gdrive:new_drive_video_2',
    filename: args.filename,
  }));

  const trashedAssets = [];
  t.mock.method(videoStorageGateway, 'deleteProjectAsset', async args => {
    trashedAssets.push(args);
    return true;
  });

  let updatedDoc = null;
  t.mock.method(StoryboardVideo, 'findOneAndUpdate', (filter, update) => {
    assert.equal(filter.storageKey, 'gdrive:old_drive_video_1');
    updatedDoc = { ...existing, ...update.$set, updatedAt: new Date() };
    return updatedDoc;
  });

  const mp4Buffer = createValidMp4Buffer();
  const res = await importFlowVideoSingleFrame({
    project,
    userId: project.userId,
    frameId,
    inputFingerprint: fingerprint,
    fileBuffer: mp4Buffer,
    uploadedFilename: 'drive_video.mp4',
  });

  assert.equal(res.success, true);
  assert.equal(res.result.outcome, 'replaced');
  assert.equal(updatedDoc.storageKey, 'gdrive:new_drive_video_2');
  assert.equal(trashedAssets.length, 1);
  assert.equal(trashedAssets[0].storageKey, 'gdrive:old_drive_video_1');
  assert.equal(trashedAssets[0].userId, project.userId);
});

test('importFlowVideoSingleFrame cleans up ONLY new Drive file on MongoDB failure', async t => {
  const project = createFixtureProject();
  project.projectPath = '';
  project.storage = {
    provider: 'google_drive',
    driveRootFolderId: 'root_123',
    driveFolderIds: { video: 'video_folder_123' },
  };
  const frameId = FIXTURE_FRAME_ID_1;

  const image = {
    frameId, status: 'ready', storageKey: 'gdrive:img_123', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date(),
  };

  const fingerprint = videoInputFingerprint({
    frame: project.storyboard.frames[0],
    planFrame: project.videoPlan.frames[0],
    image,
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  const existing = {
    _id: 'existing_db_id',
    storageKey: 'gdrive:old_drive_video_1',
    updatedAt: new Date(100),
  };

  t.mock.method(Project, 'findOne', () => ({ select: async () => project, then: fn => fn(project) }));
  t.mock.method(StoryboardImage, 'findOne', () => ({ select: async () => image }));
  t.mock.method(StoryboardVideo, 'findOne', () => ({ select: async () => existing }));

  t.mock.method(videoStorageGateway, 'saveProjectAsset', async args => ({
    storageKey: 'gdrive:new_drive_video_3',
    filename: args.filename,
  }));

  const trashedAssets = [];
  t.mock.method(videoStorageGateway, 'deleteProjectAsset', async args => {
    trashedAssets.push(args);
    return true;
  });

  // CAS failure in MongoDB
  t.mock.method(StoryboardVideo, 'findOneAndUpdate', () => null);

  const mp4Buffer = createValidMp4Buffer();
  await assert.rejects(
    importFlowVideoSingleFrame({
      project,
      userId: project.userId,
      frameId,
      inputFingerprint: fingerprint,
      fileBuffer: mp4Buffer,
      uploadedFilename: 'drive_video.mp4',
    }),
    { code: 'VIDEO_PLAN_CONFLICT' }
  );

  // New file must be deleted, old file must NOT be deleted
  assert.equal(trashedAssets.length, 1);
  assert.equal(trashedAssets[0].storageKey, 'gdrive:new_drive_video_3');
});

test('importFlowVideoSingleFrame succeeds on Drive even if trashing old file fails after DB commit', async t => {
  const project = createFixtureProject();
  project.projectPath = '';
  project.storage = {
    provider: 'google_drive',
    driveRootFolderId: 'root_123',
    driveFolderIds: { video: 'video_folder_123' },
  };
  const frameId = FIXTURE_FRAME_ID_1;

  const image = {
    frameId, status: 'ready', storageKey: 'gdrive:img_123', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date(),
  };

  const fingerprint = videoInputFingerprint({
    frame: project.storyboard.frames[0],
    planFrame: project.videoPlan.frames[0],
    image,
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  const existing = {
    _id: 'existing_db_id',
    storageKey: 'gdrive:old_drive_video_1',
    updatedAt: new Date(100),
  };

  t.mock.method(Project, 'findOne', () => ({ select: async () => project, then: fn => fn(project) }));
  t.mock.method(StoryboardImage, 'findOne', () => ({ select: async () => image }));
  t.mock.method(StoryboardVideo, 'findOne', () => ({ select: async () => existing }));

  t.mock.method(videoStorageGateway, 'saveProjectAsset', async args => ({
    storageKey: 'gdrive:new_drive_video_4',
    filename: args.filename,
  }));

  // Deleting old file throws error
  t.mock.method(videoStorageGateway, 'deleteProjectAsset', async () => {
    throw new Error('DRIVE_API_RATE_LIMIT');
  });

  t.mock.method(StoryboardVideo, 'findOneAndUpdate', (filter, update) => ({
    ...existing,
    ...update.$set,
    status: 'ready',
    durationSec: 5.0,
  }));

  const mp4Buffer = createValidMp4Buffer();
  const res = await importFlowVideoSingleFrame({
    project,
    userId: project.userId,
    frameId,
    inputFingerprint: fingerprint,
    fileBuffer: mp4Buffer,
    uploadedFilename: 'drive_video.mp4',
  });

  assert.equal(res.success, true);
  assert.equal(res.result.outcome, 'replaced');
});
