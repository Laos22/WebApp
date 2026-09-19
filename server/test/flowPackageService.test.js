import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFlowManifest, flowFrameBaseName, frameIdFromFlowImagePath,
} from '../src/services/flowPackageService.js';

const frame = {
  id: 'frame_2626aa1d-fd27-4af6-8f49-04bbbbdc44f6', order: 7,
  scriptText: 'Текст кадра', prompt: 'Detailed prompt', referenceIds: ['ref_1'],
};

test('creates stable Flow output names containing frameId', () => {
  assert.equal(flowFrameBaseName(frame),
    'frame_0007__frame_2626aa1d-fd27-4af6-8f49-04bbbbdc44f6');
  assert.equal(flowFrameBaseName({ ...frame, fileBaseName: 'frame_2_3' }),
    'frame_2_3__frame_2626aa1d-fd27-4af6-8f49-04bbbbdc44f6');
  assert.equal(frameIdFromFlowImagePath(`images/${flowFrameBaseName(frame)}.png`), frame.id);
  assert.equal(frameIdFromFlowImagePath(`downloads/result-${frame.id}.jpeg`), frame.id);
});

test('rejects unsafe and unrelated imported paths', () => {
  assert.equal(frameIdFromFlowImagePath(`../${frame.id}.png`), null);
  assert.equal(frameIdFromFlowImagePath(`images/${frame.id}.txt`), null);
  assert.equal(frameIdFromFlowImagePath('images/random.png'), null);
});

test('manifest connects prompts, outputs and available references', () => {
  const manifest = buildFlowManifest({
    project: { _id: { toString: () => 'project_1' }, title: 'Test' },
    storyboard: { revision: 4 }, frames: [frame],
    references: [{
      id: 'ref_1', name: 'Hero', type: 'character', fileName: 'references/ref_1.png',
    }],
  });
  assert.equal(manifest.storyboardRevision, 4);
  assert.equal(manifest.frames[0].outputFile,
    `images/${flowFrameBaseName(frame)}.png`);
  assert.deepEqual(manifest.frames[0].referenceFiles, ['references/ref_1.png']);
});
