import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlannedStoryboard, planStoryboardFrames } from '../src/services/storyboardService.js';

process.env.ENCRYPTION_KEY ||= 'storyboard-job-tests-only-32-characters';
const { createStoryboardGenerationService } = await import('../src/services/storyboardGenerationService.js');

// In-memory Mongo adapter: tests run the real job orchestration without paid AI calls.
const pathValue = (doc, path) => path.split('.').reduce((value, key) => value?.[key], doc);
function matches(doc, filter) {
  if (!doc) return false;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some(part => matches(doc, part));
    const actual = pathValue(doc, key);
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      return Object.entries(expected).every(([op, value]) => {
        if (op === '$nin') return !value.includes(actual);
        if (op === '$exists') return (actual !== undefined) === value;
        if (op === '$lte') return actual <= value;
        if (op === '$gt') return actual > value;
        return false;
      });
    }
    return actual === expected;
  });
}
function collection(initial = null) {
  let doc = structuredClone(initial);
  const query = value => ({ select: async () => structuredClone(value), then: (yes, no) => Promise.resolve(structuredClone(value)).then(yes, no) });
  const update = patch => {
    Object.assign(doc, structuredClone(patch.$set || {}));
    for (const key of Object.keys(patch.$unset || {})) delete doc[key];
    doc.updatedAt = new Date();
  };
  return {
    get doc() { return doc; },
    findOne: filter => query(matches(doc, filter) ? doc : null),
    exists: async filter => matches(doc, filter),
    findOneAndUpdate(filter, patch, options = {}) {
      if (!matches(doc, filter)) {
        if (!options.upsert) return query(null);
        if (doc) throw Object.assign(new Error('duplicate'), { code: 11000 });
        doc = { _id: 'job', createdAt: new Date() };
      }
      update(patch);
      return query(doc);
    },
    async updateOne(filter, patch) {
      if (!matches(doc, filter)) return { matchedCount: 0 };
      update(patch);
      return { matchedCount: 1 };
    },
  };
}

function setup() {
  const project = { _id: 'project', userId: 'owner', title: 'Story',
    script: { status: 'confirmed', revision: 1, content: 'Story' },
    voiceover: { status: 'confirmed', revision: 1, blocks: [{ id: 'block', order: 1, adaptedText: Array(40).fill('word').join(' ') }] },
    referencePlan: { status: 'confirmed', revision: 1, items: [{ id: 'reference', selected: true }] },
  };
  const settings = { profiles: [{ _id: 'profile', type: 'text', provider: 'openrouter', apiKey: 'must-not-be-saved' }] };
  const body = { instructions: '', frames: [], expectedEditVersion: 0,
    sourceScriptRevision: 1, sourceReferencePlanRevision: 1, sourceVoiceoverRevision: 1 };
  const Jobs = collection();
  const Projects = collection(project);
  let fail = true;
  const calls = [];
  const dependencies = { Jobs, Projects, UserSettings: { findOne: async () => settings },
    generate: async (snapshot, references, current, instructions, template, profile, options) =>
      generatePlannedStoryboard(planStoryboardFrames(snapshot.voiceover.blocks), new Set(['reference']), async batch => {
        calls.push(batch[0].slot);
        if (fail && batch[0].slot === '3') throw new Error('temporary provider failure');
        return JSON.stringify({ frames: batch.map(frame => ({ slot: frame.slot, visualDescription: 'Scene', prompt: 'Image', referenceIds: ['reference'] })) });
      }, { ...options, batchSize: 2 }),
  };
  return { project, body, settings, Jobs, Projects, dependencies, calls, recover: () => { fail = false; },
    service: createStoryboardGenerationService(dependencies) };
}

test('start is durable and idempotent; failed batch resumes in a new worker without regenerating saved frames', async () => {
  const f = setup();
  const first = await f.service.enqueue(f.project, 'owner', f.body, [], f.settings);
  const repeated = await f.service.enqueue(f.project, 'owner', f.body, [], f.settings);
  assert.equal(first.runId, repeated.runId);
  assert.equal(first.status, 'queued');
  assert.equal(JSON.stringify(f.Jobs.doc).includes('must-not-be-saved'), false);
  assert.equal(first.input, undefined);
  await f.service.processNext();
  assert.equal(f.Jobs.doc.status, 'failed');
  assert.equal(f.Jobs.doc.completed, 2);
  assert.equal(f.Projects.doc.storyboard, undefined);
  f.recover();
  const restarted = createStoryboardGenerationService(f.dependencies);
  await restarted.resume('project', 'owner', first.runId);
  await restarted.processNext();
  assert.deepEqual(f.calls, ['1', '3', '3']);
  assert.equal(f.Jobs.doc.status, 'completed');
  assert.equal(f.Projects.doc.storyboard.frames.length, 4);
  assert.equal(f.Projects.doc.storyboard.editVersion, 1);
  assert.equal(f.Projects.doc.storyboard.frames.map(frame => frame.scriptText).join(' '), f.project.voiceover.blocks[0].adaptedText);
});

test('active lease excludes another worker; expired lease recovers persisted checkpoint', async () => {
  const f = setup();
  await f.service.enqueue(f.project, 'owner', f.body, [], f.settings);
  await f.service.processNext();
  f.recover();
  f.Jobs.doc.status = 'running';
  f.Jobs.doc.leaseUntil = new Date(Date.now() + 60_000);
  assert.equal(await f.service.processNext(), false);
  f.Jobs.doc.leaseUntil = new Date(0);
  await f.service.processNext();
  assert.deepEqual(f.calls, ['1', '3', '3']);
  assert.equal(f.Jobs.doc.status, 'completed');
});

test('source change blocks resume and completion; ownership prevents access', async () => {
  const f = setup();
  const job = await f.service.enqueue(f.project, 'owner', f.body, [], f.settings);
  await f.service.processNext();
  assert.equal(await f.service.summary('project', 'another-user'), null);
  await assert.rejects(f.service.resume('project', 'another-user', job.runId), { status: 404 });
  f.Projects.doc.voiceover.revision++;
  await assert.rejects(f.service.resume('project', 'owner', job.runId), { code: 'STORYBOARD_JOB_CONFLICT' });
  f.Jobs.doc.status = 'queued';
  await f.service.processNext();
  assert.equal(f.Jobs.doc.errorCode, 'STORYBOARD_JOB_CONFLICT');
  assert.deepEqual(f.calls, ['1', '3']);
  assert.equal(f.Projects.doc.storyboard, undefined);
});

test('crash between project commit and job completion does not issue AI requests again', async () => {
  const f = setup();
  f.recover();
  await f.service.enqueue(f.project, 'owner', f.body, [], f.settings);
  await f.service.processNext();
  f.Jobs.doc.status = 'running';
  f.Jobs.doc.leaseUntil = new Date(0);
  await f.service.processNext();
  assert.deepEqual(f.calls, ['1', '3']);
  assert.equal(f.Jobs.doc.status, 'completed');
  assert.equal(f.Projects.doc.storyboard.editVersion, 1);
});

test('failed checkpoint write stops further AI requests and resumes from last persisted batch', async () => {
  const f = setup();
  f.recover();
  const job = await f.service.enqueue(f.project, 'owner', f.body, [], f.settings);
  const update = f.Jobs.updateOne;
  f.Jobs.updateOne = async (filter, patch) => {
    if (patch.$set.frames) throw new Error('database write failed');
    return update(filter, patch);
  };
  await f.service.processNext();
  assert.equal(f.Jobs.doc.completed, 0);
  assert.deepEqual(f.calls, ['1']);
  f.Jobs.updateOne = update;
  await f.service.resume('project', 'owner', job.runId);
  await f.service.processNext();
  assert.deepEqual(f.calls, ['1', '1', '3']);
  assert.equal(f.Jobs.doc.status, 'completed');
});

test('storyboard uses OpenRouter for an OpenRouter profile and saves its validated response', async t => {
  const { generateStoryboard } = await import('../src/services/geminiService.js');
  const { encryptData } = await import('../src/services/encryptionService.js');
  const f = setup();
  const plan = planStoryboardFrames(f.project.voiceover.blocks);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(JSON.parse(options.body).model, 'example/model');
    assert.ok(options.signal);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ frames: plan.map(frame => ({
      slot: frame.slot, visualDescription: 'Scene', prompt: 'Image', referenceIds: ['reference'],
    })) }) } }] }));
  });
  const checkpoints = [];
  await generateStoryboard(f.project, f.project.referencePlan.items, [], '', '{{SCRIPT}}', {
    provider: 'openrouter', apiKey: encryptData('test-key'), textSettings: { primaryModel: 'example/model' },
  }, { onBatch: async frames => checkpoints.push(frames.length) });
  assert.deepEqual(checkpoints, [4]);
});

test('HTTP start returns 202 with job status and status/resume routes enforce project ownership', async t => {
  const { default: router } = await import('../src/routes/projectRoutes.js');
  const { default: Project } = await import('../src/models/Project.js');
  const { default: Settings } = await import('../src/models/Settings.js');
  const { storyboardGeneration } = await import('../src/services/storyboardGenerationService.js');
  const { ensureAuthenticated } = await import('../src/middleware/auth.js');
  const f = setup();
  const projectId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const job = { runId: 'run', status: 'queued', completed: 0, total: 4 };
  t.mock.method(Project, 'findOne', async filter => {
    assert.deepEqual(filter, { _id: projectId, userId: 'owner' });
    return f.project;
  });
  t.mock.method(Settings, 'findOne', async () => f.settings);
  t.mock.method(storyboardGeneration, 'enqueue', async () => job);
  t.mock.method(Project, 'exists', async filter => filter.userId === 'owner');
  t.mock.method(storyboardGeneration, 'summary', async () => job);
  t.mock.method(storyboardGeneration, 'resume', async () => job);
  const invoke = async (path, method, userId, body = {}) => {
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    assert.equal(route.stack[0].handle, ensureAuthenticated);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() {}, json(value) { this.body = value; return this; } };
    await route.stack.at(-1).handle({ params: { id: projectId }, user: { _id: userId }, body }, res);
    return res;
  };
  const started = await invoke('/:id/storyboard/generate', 'post', 'owner', f.body);
  assert.equal(started.statusCode, 202);
  assert.deepEqual(started.body, { success: true, generation: job });
  for (const [path, method] of [['/:id/storyboard/generation', 'get'], ['/:id/storyboard/generation/resume', 'post']]) {
    const foreign = await invoke(path, method, 'another-user', { runId: 'run' });
    assert.equal(foreign.statusCode, 404);
    const own = await invoke(path, method, 'owner', { runId: 'run' });
    assert.equal(own.body.generation.runId, 'run');
  }
});
