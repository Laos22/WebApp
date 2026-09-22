import { generateVideoPlanText } from './geminiService.js';

function needsTranslation(text) {
  return /[А-Яа-яЁёІіЇїЄєҐґ]/.test(String(text || ''));
}

export async function prepareEnglishAudioPrompt(text, profile) {
  const source = String(text || '').trim();
  if (!source || !needsTranslation(source)) return source;
  if (!profile) throw Object.assign(new Error('TEXT_PROFILE_REQUIRED'), { code: 'TEXT_PROFILE_REQUIRED' });
  const result = await generateVideoPlanText(
    `Translate and adapt the following Russian sound-design instruction into one concise English prompt for an AI audio generator. Preserve the requested sound, mood, instruments or acoustic details, intensity and timing. Do not add music when the instruction asks for a sound effect, and do not add sound effects when it asks for background music. Return JSON only: {"prompt":"English prompt"}. Source instruction: ${JSON.stringify(source)}`,
    profile, true,
  );
  let parsed;
  try { parsed = JSON.parse(result); } catch { parsed = null; }
  const prompt = typeof parsed?.prompt === 'string' ? parsed.prompt.trim() : '';
  if (!prompt || prompt.length > 4100) throw Object.assign(new Error('INVALID_AUDIO_TRANSLATION'), { code: 'INVALID_AUDIO_TRANSLATION', status: 502 });
  return prompt;
}
