import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisChunks, analysisPrompt, applyAnalysis, applyPreparedPrompt, confirmVideoPlan,
  resetVideoPrompts, classifyVideoError, assertVideoVersion, preparationPrompt,
  beginVideoAnalysis, selectionRulesPrompt, assertAnalysisCurrent } from '../src/services/videoPlanAiService.js';
import { patchVideoPlan, videoPlanResponse } from '../src/services/videoPlanService.js';
import { pendingVideoFrames, runVideoQueue } from '../../client/src/services/videoPlanQueue.js';
const fixture = () => ({ title: 'Test', storyboard: { status: 'confirmed', revision: 1, frames:
  ['a', 'b'].map((id, i) => ({ id, sourceVoiceoverBlockId: `block${i}`, scriptText: 'Narration', visualDescription: 'A landscape', prompt: 'Landscape', referenceIds: ['ref'] })) },
  referencePlan: { items: [{ id: 'ref', selected: true, name: 'Mountain', description: 'Snow' }] },
  voiceover: { blocks: [0, 1].map(i => ({ id: `block${i}`, order: i + 1, adaptedText: 'Narration' })) } });
const result = (frameId, selected = true) => JSON.stringify({ frames: [{ frameId, selected, importanceScore: selected ? 80 : 0, videoPrompt: selected ? 'Slow camera movement.' : '' }] });

test('analysis of one block includes narration, visuals, durations, references and instructions', () => {
  const project = fixture();
  project.videoPlan = patchVideoPlan(project, { expectedEditVersion: 0, frames: [], instructions: 'Slow motion' });
  const chunk = analysisChunks(project)[0];
  const prompt = analysisPrompt(project, chunk, videoPlanResponse(project));
  for (const value of ['Narration', 'A landscape', 'Mountain', 'Slow motion', 'durationSec']) assert.ok(prompt.includes(value));
  const plan = applyAnalysis(project, chunk, result('a'), 1);
  assert.equal(plan.frames[0].selected, true);
  assert.equal(plan.frames[0].promptStatus, 'pending');
  assert.equal(plan.frames[1].videoPrompt, '');
});
test('analysis rejects unknown, missing and duplicate frame IDs without changing plan', () => {
  const project = fixture();
  for (const response of [result('unknown'), '{}', '<html>', '{"frames":[]}', '{"frames":[null]}'])
    assert.throws(() => applyAnalysis(project, analysisChunks(project)[0], response, 0), { code: 'INVALID_AI_RESPONSE' });
  assert.equal(project.videoPlan, undefined);
});
test('bounded chunks split oversized voiceover blocks', () => {
  const project = fixture();
  project.storyboard.frames = Array.from({ length: 50 }, (_, i) => ({ ...project.storyboard.frames[0], id: String(i), prompt: 'x'.repeat(4000) }));
  const chunks = analysisChunks(project);
  assert.ok(chunks.length > 6);
  assert.equal(chunks.flatMap(c => c.frameIds).length, 50);
  assert.ok(chunks.every(c => c.frameIds.length <= 8));
});
test('each successful analysis part persists and later invalid response preserves prior results', () => {
  const project = fixture();
  const chunks = analysisChunks(project);
  project.videoPlan = applyAnalysis(project, chunks[0], result('a'), 0);
  const first = structuredClone(project.videoPlan);
  assert.throws(() => applyAnalysis(project, chunks[1], '<html>', 1));
  assert.deepEqual(project.videoPlan, first);
  project.videoPlan = applyAnalysis(project, chunks[1], result('b'), 1);
  assert.deepEqual(project.videoPlan.frames[0], first.frames[0]);
});
test('prepare changes only target frame, marks identical draft ready, and rejects optimistic conflict', () => {
  const project = fixture();
  project.videoPlan = applyAnalysis(project, analysisChunks(project)[0], result('a'), 0);
  const other = structuredClone(project.videoPlan.frames[1]);
  project.videoPlan = applyPreparedPrompt(project, 'a', 'Slow camera movement.', 1);
  assert.equal(project.videoPlan.frames[0].promptStatus, 'ready');
  assert.deepEqual(project.videoPlan.frames[1], other);
  assert.throws(() => applyPreparedPrompt(project, 'a', 'Move camera.', 1), { code: 'VIDEO_PLAN_CONFLICT' });
  assert.throws(() => assertVideoVersion(project, 1), { code: 'VIDEO_PLAN_CONFLICT' });
  assert.throws(() => preparationPrompt(project, 'a', videoPlanResponse(project)), { code: 'IMAGE_MISSING' });
});
test('approval accepts ready current plan, rejects empty prompts, pending drafts and stale structure', () => {
  const project = fixture();
  project.videoPlan = applyAnalysis(project, analysisChunks(project)[0], result('a'), 0);
  assert.throws(() => confirmVideoPlan(project, 1), { code: 'PLAN_NOT_READY' });
  project.videoPlan = applyPreparedPrompt(project, 'a', 'Move camera slowly.', 1);
  const source = structuredClone(project.storyboard);
  assert.equal(confirmVideoPlan(project, 2).status, 'confirmed');
  assert.deepEqual(project.storyboard, source);
  project.videoPlan.frames[0].videoPrompt = ' ';
  assert.throws(() => confirmVideoPlan(project, 2), { code: 'PLAN_NOT_READY' });
  project.storyboard.revision++;
  assert.throws(() => confirmVideoPlan(project, 2), { code: 'FRAME_CHANGED' });
});
test('resume skips completed prompts; reset changes statuses only on selected frames', () => {
  const project = fixture();
  project.videoPlan = applyAnalysis(project, analysisChunks(project)[0], result('a'), 0);
  project.videoPlan = applyPreparedPrompt(project, 'a', 'Move camera slowly.', 1);
  assert.deepEqual(pendingVideoFrames(project.videoPlan), []);
  const reset = resetVideoPrompts(project, 2);
  assert.deepEqual(pendingVideoFrames(reset), ['a']);
  assert.deepEqual(reset.frames[1], project.videoPlan.frames[1]);
});
test('rate limit classification supports Retry-After seconds and dates and hides raw errors', () => {
  assert.equal(classifyVideoError({ status: 429, response: { headers: { 'retry-after': '12' } } }).retryAfterMs, 12000);
  assert.ok(classifyVideoError({ code: 429, response: { headers: { 'retry-after': new Date(Date.now() + 20000).toUTCString() } } }).retryAfterMs > 18000);
  assert.equal(classifyVideoError({ message: 'RESOURCE_EXHAUSTED secret' }).code, 'AI_RATE_LIMIT');
  assert.equal(JSON.stringify(classifyVideoError({ message: '<html>secret</html>' })).includes('secret'), false);
});
test('queue saves each result, retains successes after failure, and resumes only pending frames', async () => {
  const saved = [];
  await assert.rejects(runVideoQueue({ items: ['a', 'b'], stopped: () => false, onProgress() {},
    request: async id => { if (id === 'b') throw new Error('failure'); return id; }, onResult: value => saved.push(value) }));
  assert.deepEqual(saved, ['a']);
});
test('queue uses retry hint, retries boundedly and stops after current request', async () => {
  let calls = 0, stopped = false, slept = 0;
  const saved = [];
  await runVideoQueue({ items: ['a', 'b'], stopped: () => stopped, onProgress() {},
    sleep: async ms => { slept += ms; }, request: async id => {
      calls++; if (calls === 1) throw { status: 429, retryAfterMs: 1000 }; stopped = true; return id;
    }, onResult: value => saved.push(value) });
  assert.equal(slept, 1000); assert.equal(calls, 2); assert.deepEqual(saved, ['a']);
});

test('POST endpoints persist separate AI results, enforce owner/source/version guards and sanitize provider failure', async t => {
  const { default: router, videoAi } = await import('../src/routes/videoRoutes.js');
  const { default: Project } = await import('../src/models/Project.js');
  const { default: Settings } = await import('../src/models/Settings.js');
  const { default: StoryboardImage } = await import('../src/models/StoryboardImage.js');
  const { default: StoryboardVideo } = await import('../src/models/StoryboardVideo.js');
  const { ensureAuthenticated } = await import('../src/middleware/auth.js');
  const route = router.stack.find(layer => layer.route?.methods.post).route;
  assert.equal(route.stack[0].handle, ensureAuthenticated);
  const project = { ...fixture(), _id: '111111111111111111111111' };
  t.mock.method(Project, 'findOne', filter => {
    assert.equal(filter.userId, 'owner'); return { select: async () => project };
  });
  t.mock.method(Settings, 'findOne', async () => null);
  t.mock.method(StoryboardImage, 'find', () => ({ select: async () => [] }));
  t.mock.method(StoryboardVideo, 'find', async () => []);
  let writes = 0, conflict = false;
  t.mock.method(Project, 'findOneAndUpdate', (filter, update) => ({ select: async () => {
    assert.equal(filter.userId, 'owner');
    assert.deepEqual(filter.storyboard, project.storyboard);
    assert.deepEqual(filter.voiceover, project.voiceover);
    assert.deepEqual(filter.referencePlan, project.referencePlan);
    if (project.videoPlan) assert.equal(filter['videoPlan.editVersion'], project.videoPlan.editVersion);
    if (conflict) return null;
    project.videoPlan = update.$set.videoPlan; writes++; return project;
  } }));
  let fail = false;
  t.mock.method(videoAi, 'generate', async prompt => {
    if (fail) throw { status: 429, message: '<html>provider secret</html>' };
    if (prompt.includes('extract the maximum number')) return JSON.stringify({ selectionLimit: 1, allowedBlockIds: null });
    return result(prompt.includes('block0') ? 'a' : 'b');
  });
  async function post(action, version, chunkIndex = 0) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await route.stack.at(-1).handle({ params: { id: project._id, action }, user: { _id: 'owner' },
      body: { expectedEditVersion: version, chunkIndex } }, res);
    return res;
  }
  assert.equal((await post('analyze', 0)).statusCode, 409);
  assert.equal((await post('analyze-start', 0)).statusCode, 200);
  assert.equal(project.videoPlan.analysis.selectionLimit, 1);
  assert.equal((await post('analyze', 1)).statusCode, 200);
  const first = structuredClone(project.videoPlan);
  fail = true;
  const failure = await post('analyze', 2, 1);
  assert.equal(failure.statusCode, 429);
  assert.equal(JSON.stringify(failure.body).includes('provider secret'), false);
  assert.deepEqual(project.videoPlan, first); assert.equal(writes, 2);
  fail = false;
  assert.equal((await post('analyze', 0, 1)).statusCode, 409);
  conflict = true;
  assert.equal((await post('analyze', 2, 1)).statusCode, 409);
  assert.deepEqual(project.videoPlan, first);
  conflict = false;
  assert.equal((await post('analyze', 2, 1)).statusCode, 200);
  assert.deepEqual(project.videoPlan.frames[0], first.frames[0]);
  assert.equal(project.videoPlan.frames.filter(f => f.selected).length, 1);
  assert.equal((await post('confirm', 3)).statusCode, 400);
  assert.equal((await post('reset', 3)).statusCode, 200);
});

test('global limit of five across six chunks survives reload and selects stronger later candidates', () => {
  let project = fixture();
  project.storyboard.frames = Array.from({ length: 30 }, (_, i) => ({
    ...project.storyboard.frames[0], id: `frame${i}`, sourceVoiceoverBlockId: `block${Math.floor(i / 5)}`,
  }));
  project.videoPlan = patchVideoPlan(project, { expectedEditVersion: 0, frames: [],
    instructions: 'Выбери только 5 кадров для анимации.' });
  assert.ok(selectionRulesPrompt(project).includes('ACROSS THE ENTIRE requested scope'));
  assert.ok(selectionRulesPrompt(project).includes('Выбери только 5 кадров'));
  project.videoPlan = beginVideoAnalysis(project, '{"selectionLimit":5,"allowedBlockIds":null}', 1);
  const chunks = analysisChunks(project);
  assert.equal(chunks.length, 6);
  for (const [i, chunk] of chunks.entries()) {
    const text = JSON.stringify({ frames: chunk.frameIds.map(frameId => ({ frameId,
      selected: true, videoPrompt: 'Slow camera motion.', importanceScore: 50 + i })) });
    project.videoPlan = applyAnalysis(project, chunk, text, project.videoPlan.editVersion);
    assert.equal(project.videoPlan.frames.filter(f => f.selected).length, 5);
    assert.equal(project.videoPlan.analysis.completedChunks.length, i + 1);
    project = structuredClone(project); // reload persisted result before the next request
  }
  assert.deepEqual(project.videoPlan.frames.filter(f => f.selected).map(f => f.frameId), chunks[5].frameIds);
  assert.equal(project.videoPlan.frames.filter(f => f.videoPrompt).length, 30);
  const before = structuredClone(project.videoPlan);
  assert.throws(() => applyAnalysis(project, chunks[5], '{"frames":[]}', project.videoPlan.editVersion));
  assert.deepEqual(project.videoPlan, before);
});
test('analysis rules validate limits and zero excludes all candidates', () => {
  const project = fixture();
  for (const text of ['{}', 'null', '[]', '<html>', '{"selectionLimit":-1,"allowedBlockIds":null}', '{"selectionLimit":1.5,"allowedBlockIds":null}', '{"selectionLimit":"5","allowedBlockIds":null}'])
    assert.throws(() => beginVideoAnalysis(project, text, 0), { code: 'INVALID_AI_RESPONSE' });
  assert.equal(beginVideoAnalysis(project, '{"selectionLimit":100,"allowedBlockIds":null}', 0).analysis.selectionLimit, 2);
  assert.equal(beginVideoAnalysis(project, '{"selectionLimit":null,"allowedBlockIds":null}', 0).analysis.selectionLimit, null);
  project.videoPlan = beginVideoAnalysis(project, '{"selectionLimit":0,"allowedBlockIds":null}', 0);
  project.videoPlan = applyAnalysis(project, analysisChunks(project)[0], result('a'), 1);
  assert.equal(project.videoPlan.frames.filter(f => f.selected).length, 0);
});
test('manual edits invalidate analysis resume; drafts stay pending and only their frame changes', () => {
  const project = fixture();
  project.videoPlan = beginVideoAnalysis(project, '{"selectionLimit":1,"allowedBlockIds":null}', 0);
  assert.doesNotThrow(() => assertAnalysisCurrent(project));
  const other = structuredClone(project.videoPlan.frames[1]);
  project.videoPlan = patchVideoPlan(project, { expectedEditVersion: 1, frames: [
    { frameId: 'a', selected: true, videoPrompt: 'Камера приближается.', promptStatus: 'pending' },
  ] });
  assert.equal(project.videoPlan.frames[0].promptStatus, 'pending');
  assert.deepEqual(project.videoPlan.frames[1], other);
  assert.throws(() => assertAnalysisCurrent(project), { code: 'ANALYSIS_RESTART_REQUIRED' });
  assert.throws(() => confirmVideoPlan(project, 2), { code: 'PLAN_NOT_READY' });
  project.videoPlan = applyPreparedPrompt(project, 'a', 'The camera moves closer.', 2);
  assert.equal(project.videoPlan.frames[0].promptStatus, 'ready');
  assert.equal(confirmVideoPlan(project, 3).status, 'confirmed');
});
test('stale storyboard prevents resuming analysis before spending another AI request', () => {
  const project = fixture();
  project.videoPlan = beginVideoAnalysis(project, '{"selectionLimit":1,"allowedBlockIds":null}', 0);
  project.storyboard.frames[0].prompt = 'Changed';
  assert.throws(() => assertAnalysisCurrent(project), { code: 'ANALYSIS_RESTART_REQUIRED' });
});
test('overview and picker agree on total, selected, ready, drafts and missing images', async () => {
  const { videoPlanView } = await import('../../client/src/services/videoPlanView.js');
  const project = fixture();
  project.videoPlan = patchVideoPlan(project, { expectedEditVersion: 0, frames: [
    { frameId: 'a', selected: true, videoPrompt: 'Move slowly.' },
    { frameId: 'b', selected: true, videoPrompt: 'Move slowly.' },
  ] });
  const data = videoPlanResponse(project);
  data.frames[0].hasImage = true;
  let view = videoPlanView(data);
  assert.equal(view.total, 2); assert.equal(view.selected, 2); assert.equal(view.ready, 1);
  view = videoPlanView(data, { a: { ...project.videoPlan.frames[0], selected: false } });
  assert.equal(view.selected, 1); assert.equal(view.ready, 0);
  assert.equal(view.frames[0].plan.selected, false);
  assert.equal(view.frames[0].unsaved, true);
  data.videoPlan.status = 'stale';
  assert.equal(videoPlanView(data).ready, 0);
});

test('instruction scope selects at most three frames only in the first block across multiple chunks', () => {
  const project = fixture();
  project.storyboard.frames = Array.from({ length: 16 }, (_, i) => ({
    ...project.storyboard.frames[0], id: `frame${i}`, sourceVoiceoverBlockId: i < 12 ? 'block0' : 'block1',
  }));
  project.videoPlan = patchVideoPlan(project, { expectedEditVersion: 0, instructions: 'Выбери только 3 кадров для анимации в первом блоке.',
    frames: [{ frameId: 'frame15', selected: true, videoPrompt: 'Old selection outside scope.' }] });
  const catalog = selectionRulesPrompt(project);
  assert.ok(catalog.includes('"id":"block0","number":1'));
  assert.ok(catalog.includes('"id":"block1","number":2'));
  assert.ok(catalog.includes('ONLY the ID'));
  project.videoPlan = beginVideoAnalysis(project, '{"selectionLimit":3,"allowedBlockIds":["block0"]}', 1);
  const chunks = analysisChunks(project);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every(c => c.blockId === 'block0'));
  assert.equal(chunks.flatMap(c => c.frameIds).length, 12);
  for (const chunk of chunks) {
    project.videoPlan = applyAnalysis(project, chunk, JSON.stringify({ frames: chunk.frameIds.map(frameId => ({
      frameId, selected: true, videoPrompt: 'Move camera slowly.', importanceScore: 80,
    })) }), project.videoPlan.editVersion);
    assert.ok(project.videoPlan.frames.filter(f => f.selected).length <= 3);
    assert.ok(project.videoPlan.frames.filter(f => f.selected).every(f => Number(f.frameId.slice(5)) < 12));
  }
  assert.equal(project.videoPlan.frames.filter(f => f.selected).length, 3);
  assert.equal(project.videoPlan.frames[15].selected, false);
  assert.equal(project.videoPlan.frames[15].videoPrompt, 'Old selection outside scope.');
  assert.deepEqual(project.videoPlan.analysis.allowedBlockIds, ['block0']);
  assert.deepEqual(project.videoPlan.analysis.completedChunks, [0, 1]);
  assert.throws(() => applyAnalysis(project, { blockId: 'block1', frameIds: ['frame15'] }, result('frame15'), project.videoPlan.editVersion), { code: 'INVALID_VIDEO_PLAN' });
});
test('block scope rejects unknown, duplicate, empty or missing IDs and supports multiple blocks', () => {
  const project = fixture();
  for (const scope of [[], ['unknown'], ['block0', 'block0'], [1], 'block0']) {
    assert.throws(() => beginVideoAnalysis(project, JSON.stringify({ selectionLimit: 3, allowedBlockIds: scope }), 0), { code: 'INVALID_AI_RESPONSE' });
  }
  assert.throws(() => beginVideoAnalysis(project, '{"selectionLimit":3}', 0), { code: 'INVALID_AI_RESPONSE' });
  project.videoPlan = beginVideoAnalysis(project, '{"selectionLimit":3,"allowedBlockIds":["block1"]}', 0);
  assert.equal(project.videoPlan.analysis.selectionLimit, 1);
  assert.deepEqual(analysisChunks(project).map(c => c.blockId), ['block1']);
  project.videoPlan = beginVideoAnalysis(project, '{"selectionLimit":null,"allowedBlockIds":["block0","block1"]}', 1);
  assert.deepEqual(analysisChunks(project).map(c => c.blockId), ['block0', 'block1']);
});
test('animation filter preserves global frame numbers, unsaved deselection and empty state', async () => {
  const { filterVideoFrames } = await import('../../client/src/services/videoPlanView.js');
  const view = { frames: [
    { frameId: 'a', plan: { selected: false } },
    { frameId: 'b', plan: { selected: true } },
    { frameId: 'c', plan: { selected: false }, unsaved: true },
    { frameId: 'd', plan: { selected: true } },
  ] };
  assert.deepEqual(filterVideoFrames(view, 'all').map(f => f.index), [0, 1, 2, 3]);
  assert.deepEqual(filterVideoFrames(view, 'animation').map(f => f.index), [1, 2, 3]);
  view.frames[2].unsaved = false;
  assert.deepEqual(filterVideoFrames(view, 'animation').map(f => f.index), [1, 3]);
  view.frames.forEach(f => { f.plan.selected = false; });
  assert.deepEqual(filterVideoFrames(view, 'animation'), []);
});
