import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const { createStoryboardImagePreview } = await import('../src/services/storyboardImageStorage.js');

test('creates a bounded WebP preview without enlarging the source', async () => {
  const source = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: '#663399' },
  }).jpeg({ quality: 95 }).toBuffer();
  const preview = await createStoryboardImagePreview(source);
  const metadata = await sharp(preview).metadata();

  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1280);
  assert.equal(metadata.height, 720);
  assert.ok(preview.length < source.length);
});

test('rejects invalid preview input', async () => {
  await assert.rejects(
    createStoryboardImagePreview(Buffer.from('not an image')),
    error => error.code === 'STORYBOARD_IMAGE_PREVIEW_FAILED',
  );
});
