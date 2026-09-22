import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  buildFlowVideoManifest,
  flowVideoBaseName,
  flowVideoPromptsText,
  selectPendingFlowVideoFrames,
  verifyFlowVideoExportSnapshot,
  createFlowVideoExportPackage,
  MAX_FLOW_VIDEO_FRAMES,
} from '../src/services/flowVideoPackageService.js';
import { videoInputFingerprint } from '../src/services/videoPlanService.js';
import {
  createFixtureProject,
  FIXTURE_PROJECT_ID,
  FIXTURE_FRAME_ID_1,
  FIXTURE_FRAME_ID_2,
  PNG_HEADER,
} from './helpers/flowVideoFixtures.js';

test('flowVideoBaseName builds stable filename without block or frame numbers and validates frameId/fingerprint', () => {
  const base = flowVideoBaseName(FIXTURE_FRAME_ID_1, 'a'.repeat(64));
  assert.equal(base, `video_${FIXTURE_FRAME_ID_1}__${'a'.repeat(64)}`);

  assert.throws(() => flowVideoBaseName('../unsafe', 'a'.repeat(64)), { code: 'INVALID_FRAME_ID' });
  assert.throws(() => flowVideoBaseName(FIXTURE_FRAME_ID_1, 'invalid_hex'), { code: 'INVALID_INPUT_FINGERPRINT' });
});

test('buildFlowVideoManifest contains only explicit allowlisted fields and excludes internal keys', () => {
  const project = createFixtureProject();
  const frames = [
    {
      frameId: FIXTURE_FRAME_ID_1,
      blockNumber: 1,
      frameInBlock: 1,
      inputFingerprint: 'a'.repeat(64),
      expectedDurationSec: 5.0,
      durationExact: true,
      imageFile: `images/video_${FIXTURE_FRAME_ID_1}__${'a'.repeat(64)}.png`,
      promptFile: `prompts/video_${FIXTURE_FRAME_ID_1}__${'a'.repeat(64)}.txt`,
      outputFile: `video/video_${FIXTURE_FRAME_ID_1}__${'a'.repeat(64)}.mp4`,
    },
  ];

  const manifest = buildFlowVideoManifest({
    project,
    storyboardRevision: 1,
    videoPlanRevision: 2,
    frames,
    createdAt: '2026-09-22T12:00:00.000Z',
  });

  const manifestKeys = Object.keys(manifest).sort();
  assert.deepEqual(manifestKeys, ['createdAt', 'frames', 'kind', 'projectId', 'schemaVersion', 'storyboardRevision', 'videoPlanRevision'].sort());
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'webapp-flow-video');
  assert.equal(manifest.projectId, FIXTURE_PROJECT_ID);
  assert.equal(manifest.storyboardRevision, 1);
  assert.equal(manifest.videoPlanRevision, 2);

  const frameKeys = Object.keys(manifest.frames[0]).sort();
  assert.deepEqual(frameKeys, [
    'blockNumber', 'durationExact', 'expectedDurationSec', 'frameId', 'frameInBlock',
    'imageFile', 'inputFingerprint', 'outputFile', 'promptFile',
  ].sort());

  const json = JSON.stringify(manifest);
  assert.equal(json.includes('storageKey'), false);
  assert.equal(json.includes('projectPath'), false);
  assert.equal(json.includes('operationId'), false);
  assert.equal(json.includes('gdrive'), false);
});

test('flowVideoPromptsText formats summary with block numbers and video prompts', () => {
  const frames = [
    {
      frameId: FIXTURE_FRAME_ID_1,
      blockNumber: 1,
      frameInBlock: 2,
      inputFingerprint: 'a'.repeat(64),
      expectedDurationSec: 4.5,
      durationExact: true,
      imageFile: 'images/v1.png',
      outputFile: 'video/v1.mp4',
      scriptText: 'Озвучка',
      videoPrompt: 'Динамичное движение камеры',
    },
  ];
  const text = flowVideoPromptsText(frames);
  assert.ok(text.includes('КАДР 1 (Блок 1, кадр 2)'));
  assert.ok(text.includes(`frameId: ${FIXTURE_FRAME_ID_1}`));
  assert.ok(text.includes('4.50с (точно: да)'));
  assert.ok(text.includes('Динамичное движение камеры'));
});

test('selectPendingFlowVideoFrames selects only frames needing generation and skips ready matching videos', () => {
  const project = createFixtureProject();
  const f1 = project.storyboard.frames[0];
  const p1 = project.videoPlan.frames[0];
  const images = [
    { frameId: f1.id, status: 'ready', storageKey: 'project/images/frame_1_1.png', sourcePrompt: f1.prompt, sourceReferenceIds: [], generatedAt: new Date() },
    { frameId: project.storyboard.frames[1].id, status: 'ready', storageKey: 'project/images/frame_2_1.png', sourcePrompt: project.storyboard.frames[1].prompt, sourceReferenceIds: [], generatedAt: new Date() },
  ];

  const fp1 = videoInputFingerprint({
    frame: f1,
    planFrame: p1,
    image: images[0],
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  const videos = [
    { frameId: f1.id, status: 'ready', inputFingerprint: fp1, storageKey: 'project/video/video_1_1.mp4' },
  ];

  const result = selectPendingFlowVideoFrames({ project, images, videos });
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].frameId, FIXTURE_FRAME_ID_2);
});

test('selectPendingFlowVideoFrames throws NO_PENDING_VIDEOS (409) when all videos are ready', () => {
  const project = createFixtureProject();
  const f1 = project.storyboard.frames[0];
  const f2 = project.storyboard.frames[1];
  const images = [
    { frameId: f1.id, status: 'ready', storageKey: 'project/images/frame_1_1.png', sourcePrompt: f1.prompt, sourceReferenceIds: [], generatedAt: new Date() },
    { frameId: f2.id, status: 'ready', storageKey: 'project/images/frame_2_1.png', sourcePrompt: f2.prompt, sourceReferenceIds: [], generatedAt: new Date() },
  ];

  const videos = [
    {
      frameId: f1.id, status: 'ready', storageKey: 'project/video/v1.mp4',
      inputFingerprint: videoInputFingerprint({ frame: f1, planFrame: project.videoPlan.frames[0], image: images[0], durationSec: 5.0, generationProfileId: 'google-flow', provider: 'google-flow' }),
    },
    {
      frameId: f2.id, status: 'ready', storageKey: 'project/video/v2.mp4',
      inputFingerprint: videoInputFingerprint({ frame: f2, planFrame: project.videoPlan.frames[1], image: images[1], durationSec: 6.0, generationProfileId: 'google-flow', provider: 'google-flow' }),
    },
  ];

  assert.throws(() => selectPendingFlowVideoFrames({ project, images, videos }), { code: 'NO_PENDING_VIDEOS' });
});

test('selectPendingFlowVideoFrames rejects unconfirmed video plan or unconfirmed storyboard', () => {
  const project = createFixtureProject();
  project.videoPlan.status = 'draft';
  assert.throws(() => selectPendingFlowVideoFrames({ project, images: [], videos: [] }), { code: 'VIDEO_PLAN_NOT_CONFIRMED' });

  project.videoPlan.status = 'confirmed';
  project.storyboard.status = 'draft';
  assert.throws(() => selectPendingFlowVideoFrames({ project, images: [], videos: [] }), { code: 'STORYBOARD_NOT_CONFIRMED' });
});

test('selectPendingFlowVideoFrames throws IMAGE_MISSING when a selected frame lacks ready image', () => {
  const project = createFixtureProject();
  const images = [
    { frameId: FIXTURE_FRAME_ID_1, status: 'ready', storageKey: 'project/images/f1.png', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date() },
  ];
  assert.throws(() => selectPendingFlowVideoFrames({ project, images, videos: [] }), { code: 'IMAGE_MISSING' });
});

test('verifyFlowVideoExportSnapshot detects concurrent modifications of prompt, duration, image, or revision', () => {
  const project = createFixtureProject();
  const images = [
    { frameId: FIXTURE_FRAME_ID_1, status: 'ready', storageKey: 'img_1', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date() },
  ];
  project.videoPlan.frames[1].selected = false;

  const initialFingerprint = videoInputFingerprint({
    frame: project.storyboard.frames[0],
    planFrame: project.videoPlan.frames[0],
    image: images[0],
    durationSec: 5.0,
    generationProfileId: 'google-flow',
    provider: 'google-flow',
  });

  const expectedFrames = [{
    frameId: FIXTURE_FRAME_ID_1,
    inputFingerprint: initialFingerprint,
  }];

  // Initial verification passes
  assert.doesNotThrow(() => verifyFlowVideoExportSnapshot({ project, images, expectedFrames }));

  // 1. Image generatedAt / fingerprint changes
  const modifiedImages = [
    { ...images[0], generatedAt: new Date(Date.now() + 10000) },
  ];
  assert.throws(() => verifyFlowVideoExportSnapshot({ project, images: modifiedImages, expectedFrames }), { code: 'FRAME_CHANGED' });

  // 2. Video prompt changes
  const modifiedPromptProject = structuredClone(project);
  modifiedPromptProject.videoPlan.frames[0].videoPrompt = 'Новый измененный промт';
  assert.throws(() => verifyFlowVideoExportSnapshot({ project: modifiedPromptProject, images, expectedFrames }), { code: 'FRAME_CHANGED' });

  // 3. Audio duration changes
  const modifiedDurationProject = structuredClone(project);
  modifiedDurationProject.voiceover.blocks[0].audioDurationSec = 9.5;
  assert.throws(() => verifyFlowVideoExportSnapshot({ project: modifiedDurationProject, images, expectedFrames }), { code: 'FRAME_CHANGED' });

  // 4. VideoPlan unconfirmed
  const unconfirmedPlanProject = structuredClone(project);
  unconfirmedPlanProject.videoPlan.status = 'draft';
  assert.throws(() => verifyFlowVideoExportSnapshot({ project: unconfirmedPlanProject, images, expectedFrames }), { code: 'VIDEO_PLAN_CONFLICT' });

  // 5. Storyboard revision changed
  assert.throws(
    () => verifyFlowVideoExportSnapshot({
      project, images, expectedFrames,
      expectedStoryboardRevision: 99,
    }),
    { code: 'FRAME_CHANGED' }
  );

  // 6. VideoPlan revision changed
  assert.throws(
    () => verifyFlowVideoExportSnapshot({
      project, images, expectedFrames,
      expectedVideoPlanRevision: 99,
    }),
    { code: 'VIDEO_PLAN_CONFLICT' }
  );

  // 7. EditVersion changed
  assert.throws(
    () => verifyFlowVideoExportSnapshot({
      project, images, expectedFrames,
      expectedEditVersion: 99,
    }),
    { code: 'VIDEO_PLAN_CONFLICT' }
  );

  // 8. Frame selection changed: a new frame was selected during packaging
  assert.throws(
    () => verifyFlowVideoExportSnapshot({
      project, images, expectedFrames,
      expectedSelectedFrameIds: [FIXTURE_FRAME_ID_1, FIXTURE_FRAME_ID_2], // project has only FIXTURE_FRAME_ID_1 selected
    }),
    { code: 'VIDEO_PLAN_CONFLICT' }
  );

  // 9. Frame selection changed: an existing frame was deselected during packaging
  const bothSelectedProject = structuredClone(project);
  bothSelectedProject.videoPlan.frames[1].selected = true;
  assert.throws(
    () => verifyFlowVideoExportSnapshot({
      project: bothSelectedProject, images, expectedFrames,
      expectedSelectedFrameIds: [FIXTURE_FRAME_ID_1], // project now has both selected
    }),
    { code: 'VIDEO_PLAN_CONFLICT' }
  );
});

test('createFlowVideoExportPackage builds valid zip archive containing manifest, prompts and images', async () => {
  const project = createFixtureProject();
  const images = [
    { frameId: FIXTURE_FRAME_ID_1, status: 'ready', storageKey: 'img_1', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date() },
    { frameId: FIXTURE_FRAME_ID_2, status: 'ready', storageKey: 'img_2', sourcePrompt: project.storyboard.frames[1].prompt, sourceReferenceIds: [], generatedAt: new Date() },
  ];

  const pkg = await createFlowVideoExportPackage({
    project,
    images,
    videos: [],
    readImageFile: async key => Buffer.concat([PNG_HEADER, Buffer.alloc(100, 0x55)]),
  });

  assert.equal(pkg.frameCount, 2);
  assert.equal(pkg.filename, 'flow-video-r1.zip');
  assert.ok(Buffer.isBuffer(pkg.zipBuffer));

  const zip = await JSZip.loadAsync(pkg.zipBuffer);
  const manifestFile = zip.file('manifest.json');
  assert.ok(manifestFile);
  const manifest = JSON.parse(await manifestFile.async('string'));
  assert.equal(manifest.frames.length, 2);

  const promptsFile = zip.file('prompts.txt');
  assert.ok(promptsFile);
  const promptsContent = await promptsFile.async('string');
  assert.ok(promptsContent.includes('Камера медленно приближается'));

  const readmeFile = zip.file('README.txt');
  assert.ok(readmeFile);

  const f1Image = zip.file(manifest.frames[0].imageFile);
  assert.ok(f1Image);
  const f1Prompt = zip.file(manifest.frames[0].promptFile);
  assert.ok(f1Prompt);
  assert.equal(await f1Prompt.async('string'), 'Камера медленно приближается');
});

test('createFlowVideoExportPackage enforces 3A limits: max 15 MiB per image, max 64 MiB total, and max frames', async () => {
  const project = createFixtureProject();
  const images = [
    { frameId: FIXTURE_FRAME_ID_1, status: 'ready', storageKey: 'img_1', sourcePrompt: project.storyboard.frames[0].prompt, sourceReferenceIds: [], generatedAt: new Date() },
  ];
  project.videoPlan.frames[1].selected = false;

  // 1. Single image exceeding 15 MiB
  await assert.rejects(
    createFlowVideoExportPackage({
      project,
      images,
      videos: [],
      readImageFile: async () => Buffer.concat([PNG_HEADER, Buffer.alloc(16 * 1024 * 1024, 0x01)]),
    }),
    { code: 'VIDEO_EXPORT_TOO_LARGE' }
  );

  // 2. Total images exceeding 64 MiB (e.g. 5 images of 14 MiB each)
  const multiFrameProject = createFixtureProject();
  multiFrameProject.voiceover.blocks = [{ id: 'b1', order: 1, adaptedText: 'Текст озвучки первого блока для видео', audioDurationSec: 30.0, audioStatus: 'ready' }];
  multiFrameProject.storyboard.frames = Array.from({ length: 5 }, (_, i) => ({
    id: `frame_${String(i + 1).repeat(8)}-1111-4111-8111-111111111111`,
    sourceVoiceoverBlockId: 'b1',
    scriptText: 'Текст озвучки первого блока для видео',
    prompt: `Промт ${i + 1}`,
    referenceIds: [],
  }));
  multiFrameProject.videoPlan.frames = multiFrameProject.storyboard.frames.map(f => ({
    frameId: f.id,
    selected: true,
    videoPrompt: 'Промт движения',
    promptStatus: 'ready',
  }));
  const multiImages = multiFrameProject.storyboard.frames.map(f => ({
    frameId: f.id,
    status: 'ready',
    storageKey: `img_${f.id}`,
    sourcePrompt: f.prompt,
    sourceReferenceIds: [],
    generatedAt: new Date(),
  }));

  await assert.rejects(
    createFlowVideoExportPackage({
      project: multiFrameProject,
      images: multiImages,
      videos: [],
      readImageFile: async () => Buffer.concat([PNG_HEADER, Buffer.alloc(14 * 1024 * 1024, 0x02)]),
    }),
    { code: 'VIDEO_EXPORT_TOO_LARGE' }
  );
});
