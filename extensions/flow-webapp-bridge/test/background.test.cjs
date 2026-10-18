const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const script = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const projectId = '6ac44efedd5ffe78127f1fb4';
const frameId = 'frame_928fa187-5305-4da1-b6c3-cca4c191558f';
const inputFingerprint = 'a'.repeat(64);
const webAppUrl = `https://aihub-webapp.onrender.com/projects/${projectId}/video`;
const imageWebAppUrl = `https://aihub-webapp.onrender.com/projects/${projectId}/image`;
const toolUrl = 'https://flow.google.com/project/de86267f-f3e0-4767-b161-3e297c3cbe5a/tool/705e5ae1-f454-4a7c-a516-bff7b843bcd9';
const imageToolUrl = 'https://flow.google.com/project/de86267f-f3e0-4767-b161-3e297c3cbe5a/tool/d4ee684e-ea93-4d1e-bbf3-40cf4b35f0dc';

function setup(pageUrl = webAppUrl) {
  const tab = { id: 7, url: pageUrl };
  const flowTab = { id: 8, url: toolUrl };
  const imageFlowTab = { id: 9, url: imageToolUrl };
  const davinciTab = { id: 10, url: 'https://davinci.ai/app/video/creations' };
  const storage = {};
  const delivered = [];
  const chrome = {
    runtime: { onMessage: { addListener() {} } },
    storage: { session: {
      async get(key) { return { [key]: storage[key] }; },
      async set(items) { Object.assign(storage, items); },
      async remove(key) { delete storage[key]; },
    } },
    tabs: {
      async get(id) { return id === tab.id ? tab : id === davinciTab.id ? davinciTab : flowTab; },
      async query({ url }) { return String(url).includes('flow.google.com') ? [flowTab, imageFlowTab] : [tab]; },
      async create() { return davinciTab; },
      async sendMessage(id, message) { delivered.push({ id, message }); return { ok: true }; },
    },
  };
  const context = { chrome, URL, RegExp, crypto: webcrypto, setTimeout, clearTimeout,
    Uint8Array, btoa, fetch: async () => ({ ok: true, headers: { get: () => '4' }, arrayBuffer: async () => Uint8Array.of(0, 0, 0, 1).buffer }) };
  vm.runInNewContext(`${script}\nthis.testApi = { handleStart, startPayloadError, handleStartVideo, handleVideoResult, handleFrameResult, videoStartPayloadError, handleStartDavinciVideo, handleDavinciVideoReady };`, context);
  return { api: context.testApi, storage, delivered };
}

test('production image page accepts a frame task when Chrome supplies its URL on the tab', async () => {
  const { api, delivered } = setup();
  const payload = { projectId, storyboardRevision: 1, frameId, batchSize: 1,
    aspectRatio: '16:9', modelDisplayName: '🍌 Nano Banana 2.1',
    filename: 'flow-storyboard-r1.zip', zipBase64: 'UEsDBA==' };
  assert.equal(api.startPayloadError(payload), '');
  const result = await api.handleStart(payload, { url: 'about:blank', tab: { id: 7, url: imageWebAppUrl } });
  assert.equal(result.ok, true);
  assert.equal(delivered[0].id, 9);
  assert.deepEqual(delivered[0].message.payload, payload);
});

test('image bridge identifies invalid batch fields', () => {
  const { api } = setup();
  const payload = { projectId, storyboardRevision: 1, frameId, batchSize: 1,
    aspectRatio: '16:9', modelDisplayName: '🍌 Nano Banana 2.1',
    filename: 'flow-storyboard-r1.zip', zipBase64: 'UEsDBA==' };
  assert.match(api.startPayloadError({ ...payload, batchSize: 21 }), /1 до 20/);
  assert.match(api.startPayloadError({ ...payload, modelDisplayName: 'unknown' }), /модель/i);
  assert.match(api.startPayloadError({ ...payload, zipBase64: '' }), /пакет/i);
});

test('production video page accepts a valid frame task', async () => {
  const { api, storage, delivered } = setup();
  const payload = { projectId, frameId, inputFingerprint, imageMimeType: 'image/png',
    imageBase64: 'aGVsbG8=', prompt: 'Slow camera movement.', modelDisplayName: 'Omni 1.1 Flash',
    resolution: '360p', durationSeconds: 4, aspectRatio: '16:9' };
  assert.equal(api.videoStartPayloadError(payload), '');
  assert.equal((await api.handleStartVideo(payload, { url: webAppUrl, tab: { id: 7, url: webAppUrl } })).ok, true);
  assert.equal(storage.flowVideoRoute.tabId, 7);
  assert.equal(delivered[0].message.type, 'START_FLOW_VIDEO');
  assert.deepEqual(delivered[0].message.payload, payload);
});

test('video settings reject combinations unavailable in Flow', () => {
  const { api } = setup();
  const payload = { projectId, frameId, inputFingerprint, imageMimeType: 'image/png',
    imageBase64: 'aGVsbG8=', prompt: 'Slow camera movement.', modelDisplayName: 'Veo 3.1 - Fast',
    resolution: '720p', durationSeconds: 8, aspectRatio: '9:16' };
  assert.equal(api.videoStartPayloadError(payload), '');
  assert.match(api.videoStartPayloadError({ ...payload, durationSeconds: 10 }), /длительность/i);
  assert.match(api.videoStartPayloadError({ ...payload, resolution: '360p' }), /качество/i);
});

test('finished video finds the project page after extension session state is lost', async () => {
  const { api, delivered } = setup();
  const result = await api.handleVideoResult({ projectId, frameId, inputFingerprint,
    mimeType: 'video/mp4', base64: 'AAAA' });
  assert.equal(result.ok, true);
  assert.equal(delivered[0].id, 7);
  assert.equal(delivered[0].message.type, 'IMPORT_FLOW_VIDEO');
});

test('reference image job starts from references page and result returns to that page', async () => {
  const referencePage = `https://aihub-webapp.onrender.com/projects/${projectId}/references`;
  const { api, storage, delivered } = setup(referencePage);
  const referenceId = frameId.replace(/^frame_/, 'ref_');
  const referenceJobs = [{ frameId, referenceId, inputFingerprint }];
  const payload = { projectId, storyboardRevision: 3, frameId, batchSize: 1,
    aspectRatio: '16:9', modelDisplayName: '🍌 Nano Banana 2.1',
    filename: 'flow-storyboard-r3.zip', zipBase64: 'UEsDBA==', referenceJobs };
  const source = { url: 'about:blank', tab: { id: 7, url: `https://aihub-webapp.onrender.com/projects/${projectId}/references` } };
  assert.equal(api.startPayloadError(payload), '');
  assert.equal((await api.handleStart(payload, source)).ok, true);
  assert.deepEqual(storage.flowRoute.referenceJobs, referenceJobs);
  const result = await api.handleFrameResult({ projectId, storyboardRevision: 3, frameId,
    mimeType: 'image/png', base64: 'aGVsbG8=' });
  assert.equal(result.ok, true);
  assert.equal(delivered.at(-1).message.type, 'IMPORT_FLOW_REFERENCE');
  assert.equal(delivered.at(-1).message.payload.referenceId, referenceId);
  assert.equal(delivered.at(-1).message.payload.inputFingerprint, inputFingerprint);
});

test('DaVinci AI job uses a dedicated tab and imports only its signed MP4', async () => {
  const { api, storage, delivered } = setup();
  const payload = { projectId, frameId, inputFingerprint, imageMimeType: 'image/jpeg',
    imageBase64: 'aGVsbG8=', prompt: 'Slow camera movement.', modelDisplayName: 'Gemini Omni Flash 1.1',
    resolution: '720p', durationSeconds: 8, aspectRatio: '16:9' };
  const sender = { tab: { id: 7, url: webAppUrl } };
  assert.equal((await api.handleStartDavinciVideo(payload, sender)).ok, true);
  assert.equal(storage['davinciVideoRoute:10'].davinciTabId, 10);
  assert.equal(delivered[0].message.type, 'START_DAVINCI_VIDEO');
  const result = await api.handleDavinciVideoReady({ projectId, frameId, inputFingerprint,
    videoUrl: 'https://storage.googleapis.com/davinciweb-b8892.appspot.com/user-outputs/account/result.mp4?signature=test' },
  { tab: { id: 10 }, url: 'https://davinci.ai/app/video/creations' });
  assert.equal(result.ok, true);
  assert.equal(delivered.at(-1).message.type, 'IMPORT_DAVINCI_VIDEO');
  assert.equal(delivered.at(-1).message.payload.base64, 'AAAAAQ==');
  assert.equal(storage['davinciVideoRoute:10'], undefined);
});

test('DaVinci AI job rejects wrong settings or an unrelated video URL', async () => {
  const { api } = setup();
  const payload = { projectId, frameId, inputFingerprint, imageMimeType: 'image/jpeg',
    imageBase64: 'aGVsbG8=', prompt: 'Slow camera movement.', modelDisplayName: 'Gemini Omni Flash 1.1',
    resolution: '720p', durationSeconds: 8, aspectRatio: '16:9' };
  assert.match((await api.handleStartDavinciVideo({ ...payload, resolution: '360p' },
    { tab: { id: 7, url: webAppUrl } })).error, /DaVinci AI/);
  await api.handleStartDavinciVideo(payload, { tab: { id: 7, url: webAppUrl } });
  assert.match((await api.handleDavinciVideoReady({ projectId, frameId, inputFingerprint,
    videoUrl: 'https://example.com/result.mp4' }, { tab: { id: 10 }, url: 'https://davinci.ai/app/video/creations' })).error,
  /адрес/);
});
