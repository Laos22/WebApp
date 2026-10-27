import { test } from 'node:test';
import assert from 'node:assert/strict';
import Project from '../src/models/Project.js';
import StoryboardImage from '../src/models/StoryboardImage.js';
import StoryboardVideo from '../src/models/StoryboardVideo.js';
import VisualReference from '../src/models/VisualReference.js';

process.env.ENCRYPTION_KEY ||= 'storyboard-image-delete-test-key-32-chars';
const { default: router } = await import('../src/routes/projectRoutes.js');
const { storyboardGeneration } = await import('../src/services/storyboardGenerationService.js');
const route = router.stack.find(layer => layer.route?.path === '/:id/storyboard/frames/:frameId/delete-image' && layer.route.methods.post).route;

const projectId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const userId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const firstId = 'frame_11111111-1111-4111-8111-111111111111';
const secondId = 'frame_22222222-2222-4222-8222-222222222222';

function fixture() {
  const frames = [firstId, secondId].map((id, index) => ({
    id, order: index + 1, sourceVoiceoverBlockId: 'voice_1',
    scriptText: `words for frame ${index}`, visualDescription: `scene ${index}`,
    prompt: `prompt ${index}`, referenceIds: ['ref_1'], promptDetailStatus: 'ready',
  }));
  const project = { _id: projectId, title: 'Test', script: { status: 'confirmed', revision: 1 },
    referencePlan: { status: 'confirmed', revision: 1, items: [{ id: 'ref_1', name: 'Castle', type: 'location', selected: true }] },
    voiceover: { status: 'confirmed', revision: 1, blocks: [] },
    storyboard: { status: 'confirmed', revision: 1, editVersion: 1, sourceScriptRevision: 1,
      sourceReferencePlanRevision: 1, sourceVoiceoverRevision: 1, frames } };
  const images = new Map(frames.map((frame, index) => [frame.id, {
    _id: `image_${index}`, projectId, userId, frameId: frame.id, status: 'ready',
    storageKey: `storyboard-images/${projectId}/${frame.id}.png`, sourcePrompt: frame.prompt,
    sourceReferenceIds: frame.referenceIds, updatedAt: new Date('2026-10-27T00:00:00Z'),
  }]));
  return { project, images };
}

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

test('deleting one frame image leaves other images, storyboard and videos untouched', async t => {
  const { project, images } = fixture();
  const originalStoryboard = structuredClone(project.storyboard);
  t.mock.method(Project, 'findOne', async () => project);
  t.mock.method(StoryboardImage, 'findOne', filter => ({ select: async () => images.get(filter.frameId) }));
  t.mock.method(StoryboardImage, 'deleteOne', async filter => {
    assert.equal(filter.frameId, undefined);
    assert.equal(filter._id, images.get(firstId)._id);
    images.delete(firstId);
    return { deletedCount: 1 };
  });
  t.mock.method(StoryboardImage, 'find', () => ({ select: async () => [...images.values()] }));
  t.mock.method(VisualReference, 'find', async () => []);
  t.mock.method(storyboardGeneration, 'summary', async () => null);
  t.mock.method(StoryboardVideo, 'deleteOne', async () => assert.fail('Video must be preserved'));
  const res = response();
  await route.stack.at(-1).handle({ params: { id: projectId, frameId: firstId }, user: { _id: userId },
    body: { sourceStoryboardRevision: 1 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.storyboard.frames[0].image.hasImage, false);
  assert.equal(res.body.storyboard.frames[1].image.hasImage, true);
  assert.equal(images.has(secondId), true);
  assert.deepEqual(project.storyboard, originalStoryboard);
});

test('stale revision cannot delete a frame image', async t => {
  const { project, images } = fixture();
  t.mock.method(Project, 'findOne', async () => project);
  t.mock.method(StoryboardImage, 'deleteOne', async () => assert.fail('Image must be preserved'));
  const res = response();
  await route.stack.at(-1).handle({ params: { id: projectId, frameId: firstId }, user: { _id: userId },
    body: { sourceStoryboardRevision: 2 } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(images.has(firstId), true);
});
