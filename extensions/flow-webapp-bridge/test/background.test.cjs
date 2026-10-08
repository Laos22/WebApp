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
const toolUrl = 'https://flow.google.com/project/de86267f-f3e0-4767-b161-3e297c3cbe5a/tool/705e5ae1-f454-4a7c-a516-bff7b843bcd9';

function setup() {
  const tab = { id: 7, url: webAppUrl };
  const flowTab = { id: 8, url: toolUrl };
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
      async get(id) { return id === tab.id ? tab : flowTab; },
      async query({ url }) { return String(url).includes('flow.google.com') ? [flowTab] : [tab]; },
      async sendMessage(id, message) { delivered.push({ id, message }); return { ok: true }; },
    },
  };
  const context = { chrome, URL, RegExp, crypto: webcrypto, setTimeout, clearTimeout };
  vm.runInNewContext(`${script}\nthis.testApi = { handleStartVideo, handleVideoResult, videoStartPayloadError };`, context);
  return { api: context.testApi, storage, delivered };
}

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
