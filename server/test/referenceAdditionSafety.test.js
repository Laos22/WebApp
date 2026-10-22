import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAdoptAddedReferences, isAdditiveReferenceEdit, validateReferenceItems } from '../src/services/referencePlanService.js';
import { storyboardImageMatchesFrame, storyboardIsCurrent, validateStoryboardFrames } from '../src/services/storyboardService.js';
import { normalizeVideoPlan, storyboardFingerprint, videoInputFingerprint, videoPlanFrameRebase, videoPlanResponse } from '../src/services/videoPlanService.js';

const firstId = 'frame_11111111-1111-4111-8111-111111111111';
const secondId = 'frame_22222222-2222-4222-8222-222222222222';
const oldRefId = 'ref_11111111-1111-4111-8111-111111111111';
const newRefId = 'ref_22222222-2222-4222-8222-222222222222';
const voiceId = 'voice_block_11111111-1111-4111-8111-111111111111';
const words = 'one two three four five six seven eight nine ten';
const editableReference = item => ({ id: item.id, name: item.name, type: item.type,
  description: item.description, reason: item.reason, mentions: item.mentions,
  prompt: item.prompt, selected: item.selected });

function fixture() {
  const reference = { id: oldRefId, name: 'Boat', type: 'object', description: 'Boat', reason: '',
    mentions: 1, prompt: 'Old boat', selected: true, version: 1 };
  const frames = [firstId, secondId].map((id, index) => ({ id, order: index + 1,
    sourceVoiceoverBlockId: voiceId, scriptText: words.split(' ').slice(index * 5, index * 5 + 5).join(' '),
    visualDescription: `Scene ${index}`, prompt: `Image ${index}`, referenceIds: [oldRefId],
    promptDetailStatus: 'ready' }));
  const project = { _id: 'a'.repeat(24), title: 'Test', script: { status: 'confirmed', revision: 1 },
    referencePlan: { status: 'confirmed', revision: 2, editVersion: 4, sourceScriptRevision: 1,
      instructions: '', items: [reference] },
    voiceover: { status: 'confirmed', revision: 3, blocks: [{ id: voiceId, order: 1, adaptedText: words, audioDurationSec: 10 }] },
    storyboard: { status: 'confirmed', revision: 5, editVersion: 7, sourceScriptRevision: 1,
      sourceReferencePlanRevision: 2, sourceVoiceoverRevision: 3, frames } };
  project.videoPlan = { status: 'confirmed', sourceStoryboardRevision: 5,
    sourceStoryboardFingerprint: storyboardFingerprint(project), frames: frames.map(frame => ({
      frameId: frame.id, selected: true, promptStatus: 'ready', videoPrompt: 'Slow motion',
    })) };
  return project;
}

test('strictly adding a reference preserves the approved board and existing frame media', () => {
  const project = fixture();
  const added = { name: 'Cossacks', type: 'character', description: 'Cossacks on the boat',
    reason: '', mentions: 1, prompt: 'Cossacks aboard', selected: true };
  const items = validateReferenceItems([...project.referencePlan.items.map(editableReference), added], project.referencePlan.items);
  assert.equal(isAdditiveReferenceEdit(project.referencePlan, items, ''), true);
  assert.equal(isAdditiveReferenceEdit(project.referencePlan, items, 'new instructions'), false);
  assert.equal(isAdditiveReferenceEdit(project.referencePlan, [{ ...items[0], prompt: 'changed' }, items[1]], ''), false);
  assert.equal(isAdditiveReferenceEdit(project.referencePlan, [items[1], items[0]], ''), false);
  project.referencePlan.items = items;
  project.referencePlan.revision++;
  project.storyboard.sourceReferencePlanRevision++;
  assert.equal(storyboardIsCurrent(project), true);
  assert.equal(normalizeVideoPlan(project).status, 'confirmed');
  assert.equal(project.storyboard.frames.every(frame => frame.referenceIds.length === 1), true);
});

test('old stale board can adopt only unchanged references already used by its frames', () => {
  const project = fixture();
  project.storyboard.sourceReferencePlanRevision = 1;
  project.storyboard.updatedAt = new Date('2026-10-20T12:00:00Z');
  project.referencePlan.items.push({ ...project.referencePlan.items[0], id: newRefId, version: 1 });
  const oldAsset = { referenceId: oldRefId, sourceReferenceVersion: 1, status: 'ready',
    updatedAt: new Date('2026-10-19T12:00:00Z') };
  assert.equal(canAdoptAddedReferences(project, [oldAsset]), true);
  assert.equal(canAdoptAddedReferences(project, [{ ...oldAsset, sourceReferenceVersion: 2 }]), false);
  assert.equal(canAdoptAddedReferences(project, [{ ...oldAsset, updatedAt: new Date('2026-10-21T12:00:00Z') }]), false);
  project.storyboard.frames[0].referenceIds.push(newRefId);
  assert.equal(canAdoptAddedReferences(project, [oldAsset]), false);
});

test('selecting the new reference stales only the edited frame image and video', () => {
  const project = fixture();
  const images = project.storyboard.frames.map(frame => ({ frameId: frame.id, status: 'ready',
    storageKey: `private/${frame.id}.jpg`, sourcePrompt: frame.prompt,
    sourceReferenceIds: [oldRefId], generatedAt: new Date(1), byteSize: 100 }));
  const initialResponse = videoPlanResponse(project, images);
  const videos = project.storyboard.frames.map((frame, index) => ({ frameId: frame.id, status: 'ready',
    inputFingerprint: videoInputFingerprint({ frame, planFrame: project.videoPlan.frames[index], image: images[index],
      durationSec: initialResponse.frames[index].targetDurationSec }),
  }));
  const edited = project.storyboard.frames.map(frame => ({ id: frame.id, sourceVoiceoverBlockId: frame.sourceVoiceoverBlockId,
    scriptText: frame.scriptText, visualDescription: frame.visualDescription, prompt: frame.prompt,
    referenceIds: frame.id === firstId ? [oldRefId, newRefId] : frame.referenceIds }));
  const frames = validateStoryboardFrames(edited, project.storyboard.frames, new Set([oldRefId, newRefId]), project.voiceover.blocks);
  const rebase = videoPlanFrameRebase(project, frames, project.storyboard.revision + 1);
  assert.ok(rebase);
  project.storyboard.frames = frames;
  project.storyboard.revision++;
  project.videoPlan.sourceStoryboardRevision = rebase['videoPlan.sourceStoryboardRevision'];
  project.videoPlan.sourceStoryboardFingerprint = rebase['videoPlan.sourceStoryboardFingerprint'];
  assert.equal(normalizeVideoPlan(project).status, 'confirmed');
  assert.equal(frames[0].promptDetailStatus, 'stale');
  assert.equal(storyboardImageMatchesFrame(images[0], frames[0]), false);
  assert.equal(storyboardImageMatchesFrame(images[1], frames[1]), true);
  const result = videoPlanResponse(project, images, videos);
  assert.equal(result.frames[0].hasImage, false);
  assert.equal(result.frames[0].video.status, 'stale');
  assert.equal(result.frames[1].hasImage, true);
  assert.equal(result.frames[1].video.status, 'ready');
});

test('saving only a new card atomically advances the reference source without unconfirming the storyboard', async t => {
  process.env.ENCRYPTION_KEY ||= 'test-encryption-key-that-is-longer-than-32-characters';
  const [{ default: router }, { default: Project }, { default: VisualReference }] = await Promise.all([
    import('../src/routes/projectRoutes.js'), import('../src/models/Project.js'), import('../src/models/VisualReference.js'),
  ]);
  const project = fixture();
  const owner = 'b'.repeat(24);
  const query = Promise.resolve([]);
  query.select = () => query;
  t.mock.method(Project, 'findOne', async () => project);
  t.mock.method(VisualReference, 'find', () => query);
  let captured;
  t.mock.method(Project, 'findOneAndUpdate', async (filter, update) => {
    captured = { filter, update };
    for (const [path, value] of Object.entries(update.$set)) {
      const parts = path.split('.');
      const key = parts.pop();
      const target = parts.reduce((object, part) => object[part], project);
      target[key] = value;
    }
    for (const [path, value] of Object.entries(update.$inc)) {
      const parts = path.split('.');
      const key = parts.pop();
      const target = parts.reduce((object, part) => object[part], project);
      target[key] += value;
    }
    return project;
  });
  const route = router.stack.find(layer => layer.route?.path === '/:id/reference-plan' && layer.route.methods.put).route;
  const req = { params: { id: project._id }, user: { _id: owner }, body: {
    instructions: '', expectedEditVersion: project.referencePlan.editVersion,
    items: [...project.referencePlan.items.map(editableReference), {
      name: 'Cossacks', type: 'character', description: 'Cossacks aboard', reason: '',
      mentions: 1, prompt: 'Cossacks on the boat', selected: true,
    }],
  } };
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
  await route.stack.at(-1).handle(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(captured.update.$set['referencePlan.status'], 'confirmed');
  assert.equal(captured.update.$set['storyboard.sourceReferencePlanRevision'], 3);
  assert.equal(captured.update.$inc['referencePlan.revision'], 1);
  assert.equal(project.storyboard.status, 'confirmed');
  assert.equal(storyboardIsCurrent(project), true);
  assert.equal(normalizeVideoPlan(project).status, 'confirmed');
  assert.equal(project.referencePlan.items.length, 2);
});

test('saving several existing cards keeps the board and video plan confirmed', async t => {
  process.env.ENCRYPTION_KEY ||= 'test-encryption-key-that-is-longer-than-32-characters';
  const [{ default: router }, { default: Project }, { default: VisualReference },
    { default: StoryboardImage }, { storyboardGeneration }] = await Promise.all([
    import('../src/routes/projectRoutes.js'), import('../src/models/Project.js'),
    import('../src/models/VisualReference.js'), import('../src/models/StoryboardImage.js'),
    import('../src/services/storyboardGenerationService.js'),
  ]);
  const project = fixture();
  project.referencePlan.items.push({ id: newRefId, name: 'Cossacks', type: 'character', selected: true, version: 1 });
  project.referencePlan.revision++;
  project.storyboard.sourceReferencePlanRevision++;
  const owner = 'b'.repeat(24);
  const query = Promise.resolve([]);
  query.select = () => query;
  t.mock.method(Project, 'findOne', async () => project);
  t.mock.method(VisualReference, 'find', () => query);
  t.mock.method(StoryboardImage, 'find', () => query);
  t.mock.method(storyboardGeneration, 'summary', async () => null);
  let captured;
  t.mock.method(Project, 'findOneAndUpdate', async (filter, update) => {
    captured = { filter, update };
    for (const [path, value] of Object.entries(update.$set)) {
      const parts = path.split('.');
      const key = parts.pop();
      parts.reduce((object, part) => object[part], project)[key] = value;
    }
    for (const [path, value] of Object.entries(update.$inc)) {
      const parts = path.split('.');
      const key = parts.pop();
      parts.reduce((object, part) => object[part], project)[key] += value;
    }
    return project;
  });
  const route = router.stack.find(layer => layer.route?.path === '/:id/storyboard/frames' && layer.route.methods.patch).route;
  const frames = project.storyboard.frames.map((frame, index) => ({
    id: frame.id, sourceVoiceoverBlockId: frame.sourceVoiceoverBlockId, scriptText: frame.scriptText,
    visualDescription: frame.visualDescription, prompt: frame.prompt,
    referenceIds: index === 0 ? [oldRefId, newRefId] : frame.referenceIds,
  }));
  const req = { params: { id: project._id }, user: { _id: owner }, body: {
    frames, expectedEditVersion: project.storyboard.editVersion,
    sourceStoryboardRevision: project.storyboard.revision,
  } };
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
  await route.stack.at(-1).handle(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(captured.update.$set['storyboard.frames'][0].promptDetailStatus, 'stale');
  assert.equal(captured.update.$set['storyboard.frames'][1].promptDetailStatus, 'ready');
  assert.equal(captured.update.$set['videoPlan.sourceStoryboardRevision'], 6);
  assert.equal(project.storyboard.status, 'confirmed');
  assert.equal(normalizeVideoPlan(project).status, 'confirmed');
  assert.equal(res.body.storyboard.frames[0].image.status, 'pending');
});
