import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY ||= 'test-encryption-key-that-is-longer-than-32-characters';

const { encryptData } = await import('../src/services/encryptionService.js');
const {
  buildGoogleImageInput, generateGoogleStoryboardImage, normalizeGoogleImageSettings,
} = await import('../src/services/googleImageService.js');

const profile = {
  type: 'image', provider: 'google_studio', apiKey: encryptData('test-google-key'),
  imageSettings: {
    model: 'gemini-3.1-flash-image', format: 'png', quality: 'hd', aspectRatio: '16:9',
  },
};

test('builds multimodal image input with selected references', () => {
  const input = buildGoogleImageInput({ prompt: 'A cinematic wide shot' }, [{
    name: 'Hero', type: 'character', mimeType: 'image/png', buffer: Buffer.from('reference'),
  }]);
  assert.equal(input.length, 3);
  assert.equal(input[0].type, 'text');
  assert.equal(input[2].type, 'image');
  assert.equal(input[2].mime_type, 'image/png');
});

test('maps profile settings to Google image response format', async () => {
  let request;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const result = await generateGoogleStoryboardImage({
    frame: { prompt: 'A cinematic wide shot' }, references: [], profile,
    clientFactory: apiKey => ({ interactions: { create: async value => {
      assert.equal(apiKey, 'test-google-key');
      request = value;
      return { output_image: { data: png.toString('base64'), mime_type: 'image/png' } };
    } } }),
  });
  assert.equal(request.model, 'gemini-3.1-flash-image');
  assert.deepEqual(request.response_format, {
    type: 'image', mime_type: 'image/png', aspect_ratio: '16:9', image_size: '2K',
  });
  assert.equal(result.mimeType, 'image/png');
});

test('rejects a non-Google image profile before generation', () => {
  assert.throws(() => normalizeGoogleImageSettings({ ...profile, provider: 'openrouter' }),
    error => error.code === 'INVALID_IMAGE_PROFILE');
});
