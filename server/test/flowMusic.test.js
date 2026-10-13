import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFlowMusicAnalysis } from '../src/services/flowMusicPlanService.js';

test('music analysis accepts a JSON object or a single-element array from the model', () => {
  const plan = { title: 'Петля', structure: 'Ровная фактура', prompt: 'Seamless instrumental loop' };
  assert.deepEqual(parseFlowMusicAnalysis(JSON.stringify(plan), 90), { ...plan, clipDurationSec: 90 });
  assert.deepEqual(parseFlowMusicAnalysis(JSON.stringify([plan]), 120), { ...plan, clipDurationSec: 120 });
  assert.deepEqual(parseFlowMusicAnalysis('```json\n' + JSON.stringify([plan]) + '\n```', 180), { ...plan, clipDurationSec: 180 });
  assert.equal(parseFlowMusicAnalysis(JSON.stringify([plan, plan]), 90), null);
  assert.equal(parseFlowMusicAnalysis(JSON.stringify([{ ...plan, prompt: '' }]), 90), null);
});

process.env.ENCRYPTION_KEY = 'flow-music-test-only-configuration-00000000000000';
const { default: router } = await import('../src/routes/projectRoutes.js');
const { default: Project } = await import('../src/models/Project.js');

function routeHandler(routePath, method) {
  return router.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method]).route.stack.at(-1).handle;
}

function response() {
  return { code: 200, status(value) { this.code = value; return this; }, json(value) { this.value = value; return this; } };
}

test('accepting a Flow Music MP3 retains the candidate file, replaces the old track and enables XML looping', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-music-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'audio'));
  const oldName = 'background_music_11111111-1111-4111-8111-111111111111.mp3';
  const newName = 'background_music_22222222-2222-4222-8222-222222222222.mp3';
  const mp3Frame = Buffer.alloc(384); mp3Frame.set([0xff, 0xfb, 0x94, 0xc0]);
  const audio = Buffer.concat(Array(150).fill(mp3Frame));
  await fs.writeFile(path.join(root, 'audio', oldName), audio);
  await fs.writeFile(path.join(root, 'audio', newName), audio);
  const updatedAt = new Date('2026-10-13T12:00:00Z');
  const project = { _id: 'project', projectPath: root, updatedAt,
    backgroundMusic: { status: 'ready', storageKey: `project/audio/${oldName}` },
    flowMusicDraft: { title: 'Новая петля', prompt: 'Seamless instrumental loop',
      sourceStoryboardRevision: 2, sourceVoiceoverRevision: 3,
      candidate: { storageKey: `project/audio/${newName}`, filename: newName, uploadedAt: new Date() } } };
  t.mock.method(Project, 'findOne', () => ({ select: async () => project }));
  let update;
  t.mock.method(Project, 'findOneAndUpdate', async (filter, value) => {
    assert.equal(filter.userId, 'owner');
    assert.deepEqual(filter.updatedAt, updatedAt);
    update = value;
    return { backgroundMusic: value.$set.backgroundMusic,
      flowMusicDraft: { ...project.flowMusicDraft, candidate: undefined } };
  });
  const res = response();
  await routeHandler('/:id/flow-music/accept', 'post')({ params: { id: 'project' }, user: { _id: 'owner' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.value.music.loop, true);
  assert.equal(res.value.music.durationSec, 3.6);
  assert.equal(update.$unset['flowMusicDraft.candidate'], '');
  await fs.access(path.join(root, 'audio', newName));
  await assert.rejects(fs.access(path.join(root, 'audio', oldName)), { code: 'ENOENT' });
});
