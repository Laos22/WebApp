import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY ||= 'test-encryption-key-that-is-longer-than-32-characters';

const { encryptData } = await import('../src/services/encryptionService.js');
const {
  getElevenLabsCharacterLimit,
  synthesizeElevenLabs,
} = await import('../src/services/elevenLabsService.js');

const profile = {
  type: 'audio',
  provider: 'elevenlabs',
  apiKey: encryptData('test-api-key'),
  audioSettings: { voiceId: 'test-voice', modelId: 'eleven_v3' },
};

test('returns documented character limits for known ElevenLabs models', () => {
  assert.equal(getElevenLabsCharacterLimit('eleven_v3'), 5000);
  assert.equal(getElevenLabsCharacterLimit('eleven_v4'), 10000);
  assert.equal(getElevenLabsCharacterLimit('eleven_multilingual_v2'), 10000);
  assert.equal(getElevenLabsCharacterLimit('custom-model'), null);
});

test('v4 uses the existing speech endpoint with supported voice settings', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(Buffer.from([0xff, 0xfb, 0x94, 0xc0]));
  };
  try {
    await synthesizeElevenLabs('Тест', {
      ...profile, audioSettings: { ...profile.audioSettings, modelId: 'eleven_v4', speed: 1.3, speakerBoost: true },
    });
    const body = JSON.parse(request.options.body);
    assert.match(request.url, /\/v1\/text-to-speech\/test-voice/);
    assert.equal(body.model_id, 'eleven_v4');
    assert.deepEqual(body.voice_settings, { stability: 0.5, similarity_boost: 0.75 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects an oversized v3 block before calling ElevenLabs', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response(); };
  try {
    await assert.rejects(
      synthesizeElevenLabs('а'.repeat(5001), profile),
      error => error.code === 'ELEVENLABS_TEXT_TOO_LONG' &&
        error.characterCount === 5001 && error.characterLimit === 5000,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps a safe ElevenLabs validation message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    detail: { status: 'voice_not_found', message: 'Voice is not available for this account' },
  }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  try {
    await assert.rejects(
      synthesizeElevenLabs('Тестовый текст', profile),
      error => error.code === 'ELEVENLABS_VOICE_NOT_FOUND' &&
        error.publicMessage.includes('Voice is not available'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
