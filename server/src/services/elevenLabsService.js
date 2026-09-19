import { getDecryptedApiKey } from './aiProfileResolver.js';

export const ELEVENLABS_MODEL_CHARACTER_LIMITS = Object.freeze({
  eleven_v3: 5000,
  eleven_multilingual_v2: 10000,
  eleven_flash_v2_5: 40000,
  eleven_flash_v2: 30000,
});

export function getElevenLabsCharacterLimit(modelId) {
  return ELEVENLABS_MODEL_CHARACTER_LIMITS[modelId] || null;
}

function publicProviderMessage(payload, fallback) {
  const detail = payload?.detail;
  const value = typeof detail === 'string' ? detail
    : detail?.message || detail?.status || payload?.message || fallback;
  return String(value || fallback).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

async function readProviderError(response) {
  const raw = await response.text().catch(() => '');
  if (!raw) return `ElevenLabs вернул HTTP ${response.status}`;
  try {
    return publicProviderMessage(JSON.parse(raw), `ElevenLabs вернул HTTP ${response.status}`);
  } catch {
    return raw.replace(/[\r\n]+/g, ' ').slice(0, 500);
  }
}

function providerErrorCode(status) {
  if (status === 401 || status === 403) return 'ELEVENLABS_AUTH_FAILED';
  if (status === 429) return 'ELEVENLABS_LIMIT_REACHED';
  if (status === 404) return 'ELEVENLABS_VOICE_NOT_FOUND';
  if (status === 400 || status === 422) return 'ELEVENLABS_INVALID_REQUEST';
  return 'ELEVENLABS_GENERATION_FAILED';
}

export async function synthesizeElevenLabs(text, profile) {
  const apiKey = getDecryptedApiKey(profile);
  const voiceId = profile?.audioSettings?.voiceId?.trim();
  if (!apiKey || !voiceId || profile?.type !== 'audio' || profile?.provider !== 'elevenlabs') {
    const error = new Error('ElevenLabs profile is incomplete');
    error.code = 'ELEVENLABS_PROFILE_REQUIRED';
    throw error;
  }
  const settings = profile.audioSettings || {};
  const modelId = settings.modelId?.trim() || 'eleven_v3';
  const preparedText = String(text || '')
    .replace(/^\s*['"]?(?:ДИКТОР|Діктор)['"]?\s*:\s*/iu, '')
    .trim();
  if (!preparedText) {
    const error = new Error('Voiceover block is empty');
    error.code = 'ELEVENLABS_EMPTY_TEXT';
    error.publicMessage = 'В блоке нет текста для озвучки.';
    error.httpStatus = 400;
    throw error;
  }
  const characterLimit = getElevenLabsCharacterLimit(modelId);
  if (characterLimit && preparedText.length > characterLimit) {
    const error = new Error(`ElevenLabs text limit exceeded: ${preparedText.length}/${characterLimit}`);
    error.code = 'ELEVENLABS_TEXT_TOO_LONG';
    error.publicMessage = `Блок содержит ${preparedText.length} символов, а модель ${modelId} принимает не более ${characterLimit}. Сократите блок или выберите модель с большим лимитом.`;
    error.httpStatus = 400;
    error.characterCount = preparedText.length;
    error.characterLimit = characterLimit;
    throw error;
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({
      text: preparedText,
      model_id: modelId,
      voice_settings: {
        stability: settings.stability ?? 0.5,
        similarity_boost: settings.similarityBoost ?? 0.75,
        use_speaker_boost: settings.speakerBoost ?? true,
        speed: settings.speed ?? 1,
      },
    }),
  });
  if (!response.ok) {
    const providerMessage = await readProviderError(response);
    console.error(`[ElevenLabs] HTTP ${response.status}: ${providerMessage}`);
    const error = new Error(`ElevenLabs request failed with HTTP ${response.status}`);
    error.code = providerErrorCode(response.status);
    error.providerStatus = response.status;
    error.publicMessage = `ElevenLabs: ${providerMessage}`;
    error.httpStatus = response.status === 401 || response.status === 403 ? 401
      : response.status === 429 ? 429
        : response.status === 400 || response.status === 404 || response.status === 422 ? 400 : 502;
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    const error = new Error('ElevenLabs returned empty audio');
    error.code = 'ELEVENLABS_EMPTY_AUDIO';
    throw error;
  }
  return buffer;
}
