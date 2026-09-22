import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import JSZip from 'jszip';
import Project from '../src/models/Project.js';
import StoryboardImage from '../src/models/StoryboardImage.js';
import StoryboardVideo from '../src/models/StoryboardVideo.js';
import router from '../src/routes/videoRoutes.js';
import { ensureAuthenticated } from '../src/middleware/auth.js';
import { videoInputFingerprint } from '../src/services/videoPlanService.js';
import {
  createFixtureProject,
  createValidMp4Buffer,
  FIXTURE_PROJECT_ID,
  FIXTURE_USER_ID,
  FIXTURE_FRAME_ID_1,
  PNG_HEADER,
} from './helpers/flowVideoFixtures.js';

async function invokeRoute(routePath, method, { params = {}, query = {}, body = {}, file = null, user = { _id: FIXTURE_USER_ID } } = {}) {
  const layer = router.stack.find(l => l.route?.path === routePath && l.route.methods[method]);
  assert.ok(layer, `Route ${method.toUpperCase()} ${routePath} not found`);
  const route = layer.route;
  assert.equal(route.stack[0].handle, ensureAuthenticated);

  const res = {
    code: 200,
    headers: {},
    status(code) { this.code = code; return this; },
    json(value) { this.value = value; return this; },
    send(value) { this.value = value; return this; },
    set(key, value) { this.headers[key] = value; return this; },
  };

  const req = {
    params: { id: FIXTURE_PROJECT_ID, ...params },
    headers: { 'content-type': 'multipart/form-data' },
    query,
    body,
    file,
    user,
    isAuthenticated() {
      return Boolean(this.user);
    },
  };

  // Run the full middleware stack for this route
  for (let i = 0; i < route.stack.length; i++) {
    const handler = route.stack[i].handle;
    let nextCalled = false;
    let nextError = null;
    const next = err => { nextCalled = true; nextError = err; };
    await handler(req, res, next);
    if (!nextCalled && i < route.stack.length - 1) {
      // Handler sent response early (e.g. 400/404/413)
      break;
    }
  }
  return res;
}

test('GET /:id/video-plan/flow/export executes auth, checks owner with exact filter, and verifies snapshot before sending zip', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-export-route-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, 'images'), { recursive: true });
  await fs.writeFile(path.join(root, 'images/frame_1_1.png'), Buffer.concat([PNG_HEADER, Buffer.alloc(100, 0x11)]));

  const project = createFixtureProject({ rootPath: root, videoPlanEditVersion: 2, selected2: false });
  const frameId = FIXTURE_FRAME_ID_1;
  const image = {
    projectId: FIXTURE_PROJECT_ID,
    userId: FIXTURE_USER_ID,
    frameId,
    status: 'ready',
    storageKey: 'project/images/frame_1_1.png',
    sourcePrompt: project.storyboard.frames[0].prompt,
    sourceReferenceIds: [],
    generatedAt: new Date(),
  };

  const queriedFilters = [];
  t.mock.method(Project, 'findOne', filter => {
    queriedFilters.push(filter);
    return {
      select: async () => project,
      then: fn => fn(project),
    };
  });

  t.mock.method(StoryboardImage, 'find', () => ({
    select: async () => [image],
  }));

  t.mock.method(StoryboardVideo, 'find', async () => []);

  // 1. Missing version -> 400
  const badReq = await invokeRoute('/:id/video-plan/flow/export', 'get', { query: {} });
  assert.equal(badReq.code, 400);

  // 2. Version conflict -> 409
  const conflictReq = await invokeRoute('/:id/video-plan/flow/export', 'get', { query: { expectedEditVersion: '99' } });
  assert.equal(conflictReq.code, 409);

  // 3. Success -> 200 ZIP
  const successReq = await invokeRoute('/:id/video-plan/flow/export', 'get', { query: { expectedEditVersion: '2' } });
  assert.equal(successReq.code, 200);
  assert.equal(successReq.headers['Content-Type'], 'application/zip');
  assert.ok(successReq.headers['Content-Disposition'].includes('flow-video-r1.zip'));

  // Ensure exact { _id, userId } filter was used on both initial and snapshot check queries
  for (const filter of queriedFilters) {
    assert.equal(filter._id, FIXTURE_PROJECT_ID);
    assert.equal(filter.userId, FIXTURE_USER_ID);
  }

  const zip = await JSZip.loadAsync(successReq.value);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.kind, 'webapp-flow-video');
  assert.equal(manifest.frames.length, 1);
  assert.equal(manifest.frames[0].frameId, frameId);
});

test('POST /:id/video-plan/frames/:frameId/import-flow-video validates project owner before upload parsing', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-mw-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  // Simulate non-existent project: requireOwnedProject returns 404
  t.mock.method(Project, 'findOne', () => ({
    select: async () => null,
  }));

  const res = await invokeRoute('/:id/video-plan/frames/:frameId/import-flow-video', 'post', {
    params: { frameId: FIXTURE_FRAME_ID_1 },
    body: {},
  });

  assert.equal(res.code, 404);
  assert.equal(res.value.code, 'PROJECT_NOT_FOUND');
});

test('POST /:id/video-plan/frames/:frameId/import-flow-video validates MP4, fingerprint and returns safe public video result', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-import-route-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const project = createFixtureProject({ rootPath: root, videoPlanEditVersion: 2, selected2: false });
  const frameId = FIXTURE_FRAME_ID_1;
  const image = {
    _id: '607f1f77bcf86cd799439022',
    projectId: FIXTURE_PROJECT_ID,
    userId: FIXTURE_USER_ID,
    frameId,
    status: 'ready',
    storageKey: 'project/images/frame_1_1.png',
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

  t.mock.method(Project, 'findOne', filter => {
    assert.equal(filter._id, FIXTURE_PROJECT_ID);
    assert.equal(filter.userId, FIXTURE_USER_ID);
    return {
      select: async () => project,
      then: fn => fn(project),
    };
  });

  t.mock.method(StoryboardImage, 'findOne', () => ({
    select: async () => image,
  }));

  let dbVideo = null;
  t.mock.method(StoryboardVideo, 'findOne', () => ({
    select: async () => dbVideo,
  }));

  t.mock.method(StoryboardVideo, 'create', async doc => {
    dbVideo = { ...doc, _id: 'vid_1', updatedAt: new Date() };
    return dbVideo;
  });

  const mp4Buffer = createValidMp4Buffer({ durationSec: 5.0, width: 1920, height: 1080 });

  // 1. Missing file -> 400
  const noFileReq = await invokeRoute('/:id/video-plan/frames/:frameId/import-flow-video', 'post', {
    params: { frameId },
    body: { inputFingerprint: expectedFingerprint },
    file: null,
  });
  assert.equal(noFileReq.code, 400);

  // 2. Missing / invalid fingerprint -> 400
  const badFpReq = await invokeRoute('/:id/video-plan/frames/:frameId/import-flow-video', 'post', {
    params: { frameId },
    body: { inputFingerprint: 'bad' },
    file: { buffer: mp4Buffer, originalname: 'test.mp4' },
  });
  assert.equal(badFpReq.code, 400);

  // 3. Stale fingerprint -> 409
  const staleReq = await invokeRoute('/:id/video-plan/frames/:frameId/import-flow-video', 'post', {
    params: { frameId },
    body: { inputFingerprint: 'f'.repeat(64) },
    file: { buffer: mp4Buffer, originalname: 'test.mp4' },
  });
  assert.equal(staleReq.code, 409);

  // 4. Invalid MP4 buffer -> 415
  const invalidMp4Req = await invokeRoute('/:id/video-plan/frames/:frameId/import-flow-video', 'post', {
    params: { frameId },
    body: { inputFingerprint: expectedFingerprint },
    file: { buffer: Buffer.from('not an mp4 file'), originalname: 'test.mp4' },
  });
  assert.equal(invalidMp4Req.code, 415);

  // 5. Successful import -> 200
  const successReq = await invokeRoute('/:id/video-plan/frames/:frameId/import-flow-video', 'post', {
    params: { frameId },
    body: { inputFingerprint: expectedFingerprint },
    file: { buffer: mp4Buffer, originalname: `video_${frameId}__${expectedFingerprint}.mp4` },
  });

  assert.equal(successReq.code, 200);
  assert.equal(successReq.value.success, true);
  assert.equal(successReq.value.result.frameId, frameId);
  assert.equal(successReq.value.result.outcome, 'imported');
  assert.equal(successReq.value.result.video.status, 'ready');
  assert.equal(successReq.value.result.video.durationSec, 5.0);
  assert.equal(successReq.value.result.video.width, 1920);
  assert.equal(successReq.value.result.video.height, 1080);
  assert.equal(successReq.value.result.video.provider, 'google-flow');

  // Verify internal keys are not in public response
  const json = JSON.stringify(successReq.value);
  assert.equal(json.includes('storageKey'), false);
  assert.equal(json.includes('projectPath'), false);

  // 6. Unauthenticated requests -> 401
  const unauthExport = await invokeRoute('/:id/video-plan/flow/export', 'get', { user: null });
  assert.equal(unauthExport.code, 401);

  const unauthImport = await invokeRoute('/:id/video-plan/frames/:frameId/import-flow-video', 'post', {
    params: { frameId },
    user: null,
  });
  assert.equal(unauthImport.code, 401);
});

function createMultipartPayload({ fields = {}, files = {} }) {
  const boundary = `----WebKitFormBoundaryFlowVideoTest${Math.random().toString(36).slice(2)}`;
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`
    ));
  }

  for (const [name, file] of Object.entries(files)) {
    const filename = file.filename || 'file.mp4';
    const contentType = file.contentType || 'video/mp4';
    const fileBuffer = file.buffer || Buffer.alloc(0);
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
    ));
    chunks.push(fileBuffer);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(chunks);
  return {
    boundary,
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: body.length,
  };
}

async function sendExpressMultipart(app, { url, method = 'POST', headers = {}, payload, user = null }) {
  const { Readable } = await import('node:stream');
  const req = Readable.from([payload.body]);
  req.method = method;
  req.url = url;
  req.headers = {
    'content-type': payload.contentType,
    'content-length': String(payload.contentLength),
    ...headers,
  };
  req.user = user;
  req.isAuthenticated = () => Boolean(req.user);

  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const resHeaders = {};

    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      set(k, v) {
        resHeaders[k.toLowerCase()] = v;
        return this;
      },
      setHeader(k, v) {
        resHeaders[k.toLowerCase()] = v;
        return this;
      },
      getHeader(k) {
        return resHeaders[k.toLowerCase()];
      },
      json(data) {
        this.headersSent = true;
        resolve({ status: statusCode, body: data, headers: resHeaders });
        return this;
      },
      send(data) {
        this.headersSent = true;
        let parsed = data;
        if (typeof data === 'string') {
          try { parsed = JSON.parse(data); } catch {}
        }
        resolve({ status: statusCode, body: parsed, headers: resHeaders });
        return this;
      },
      end(data) {
        this.headersSent = true;
        resolve({ status: statusCode, body: data, headers: resHeaders });
        return this;
      },
    };

    app(req, res, err => {
      if (err) reject(err);
    });
  });
}

test('HTTP multipart: unauthenticated, foreign project, extra field/file, >64MB limit, and successful import', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-http-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const project = createFixtureProject({ rootPath: root, videoPlanEditVersion: 2, selected2: false });
  const frameId = FIXTURE_FRAME_ID_1;
  const image = {
    _id: '607f1f77bcf86cd799439022',
    projectId: FIXTURE_PROJECT_ID,
    userId: FIXTURE_USER_ID,
    frameId,
    status: 'ready',
    storageKey: 'project/images/frame_1_1.png',
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

  t.mock.method(Project, 'findOne', filter => {
    if (String(filter._id) === FIXTURE_PROJECT_ID && String(filter.userId) === FIXTURE_USER_ID) {
      return { select: async () => project, then: fn => fn(project) };
    }
    return { select: async () => null, then: fn => fn(null) };
  });

  t.mock.method(StoryboardImage, 'findOne', () => ({
    select: async () => image,
  }));

  let dbVideo = null;
  t.mock.method(StoryboardVideo, 'findOne', () => ({
    select: async () => dbVideo,
  }));

  t.mock.method(StoryboardVideo, 'create', async doc => {
    dbVideo = { ...doc, _id: 'vid_1', updatedAt: new Date() };
    return dbVideo;
  });

  const app = express();
  app.use('/api/projects', router);

  const validMp4 = createValidMp4Buffer({ durationSec: 5.0, width: 1920, height: 1080 });
  const targetUrl = `/api/projects/${FIXTURE_PROJECT_ID}/video-plan/frames/${frameId}/import-flow-video`;

  // 1. Unauthenticated request -> 401
  {
    const payload = createMultipartPayload({
      fields: { inputFingerprint: expectedFingerprint },
      files: { video: { buffer: validMp4, filename: `video_${frameId}__${expectedFingerprint}.mp4` } },
    });

    const res = await sendExpressMultipart(app, {
      url: targetUrl,
      payload,
      user: null,
    });
    assert.equal(res.status, 401);
  }

  // 2. Foreign project (authenticated as other user) -> 404
  {
    const payload = createMultipartPayload({
      fields: { inputFingerprint: expectedFingerprint },
      files: { video: { buffer: validMp4, filename: `video_${frameId}__${expectedFingerprint}.mp4` } },
    });

    const res = await sendExpressMultipart(app, {
      url: targetUrl,
      payload,
      user: { _id: 'foreign_user_999' },
    });
    assert.equal(res.status, 404);
  }

  // 3a. Extra field -> 400 (Multer limits: fields: 1)
  {
    const payload = createMultipartPayload({
      fields: {
        inputFingerprint: expectedFingerprint,
        unexpectedField: 'extra_data',
      },
      files: { video: { buffer: validMp4, filename: `video_${frameId}__${expectedFingerprint}.mp4` } },
    });

    const res = await sendExpressMultipart(app, {
      url: targetUrl,
      payload,
      user: { _id: FIXTURE_USER_ID },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body?.code, 'INVALID_REQUEST');
  }

  // 3b. Second file -> 400 (Multer limits: files: 1)
  {
    const payload = createMultipartPayload({
      fields: { inputFingerprint: expectedFingerprint },
      files: {
        video: { buffer: validMp4, filename: `video_${frameId}__${expectedFingerprint}.mp4` },
        secondVideo: { buffer: validMp4, filename: 'extra.mp4' },
      },
    });

    const res = await sendExpressMultipart(app, {
      url: targetUrl,
      payload,
      user: { _id: FIXTURE_USER_ID },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body?.code, 'INVALID_REQUEST');
  }

  // 4. Exceeding 64 MiB -> 413
  {
    const oversized = Buffer.alloc(64 * 1024 * 1024 + 1024, 0x00);
    oversized.writeUInt32BE(20, 0);
    oversized.write('ftypisom', 4, 'ascii');

    const payload = createMultipartPayload({
      fields: { inputFingerprint: expectedFingerprint },
      files: { video: { buffer: oversized, filename: 'oversized.mp4' } },
    });

    const res = await sendExpressMultipart(app, {
      url: targetUrl,
      payload,
      user: { _id: FIXTURE_USER_ID },
    });
    assert.equal(res.status, 413);
    assert.equal(res.body?.code, 'PAYLOAD_TOO_LARGE');
  }

  // 5. Successful MP4 import -> 200
  {
    const payload = createMultipartPayload({
      fields: { inputFingerprint: expectedFingerprint },
      files: { video: { buffer: validMp4, filename: `video_${frameId}__${expectedFingerprint}.mp4` } },
    });

    const res = await sendExpressMultipart(app, {
      url: targetUrl,
      payload,
      user: { _id: FIXTURE_USER_ID },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.result?.frameId, frameId);
    assert.equal(res.body?.result?.outcome, 'imported');
    assert.equal(res.body?.result?.video?.status, 'ready');
    assert.equal(res.body?.result?.video?.durationSec, 5.0);
  }
});
