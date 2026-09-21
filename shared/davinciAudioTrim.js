export function validateAudioTrim(settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      Object.keys(settings).some(key => !['enabled', 'mode', 'phrase', 'startSec', 'endSec'].includes(key))) throw trimError();
  const result = { enabled: false, mode: 'phrase', phrase: '-Абзац-', startSec: 0, endSec: 0, ...settings };
  if (typeof result.enabled !== 'boolean' || !['phrase', 'seconds'].includes(result.mode) ||
      typeof result.phrase !== 'string' || !result.phrase.trim() || result.phrase.length > 200 ||
      ![result.startSec, result.endSec].every(value => Number.isFinite(value) && value >= 0 && value <= 60)) throw trimError();
  return result;
}
function trimError() { return Object.assign(new Error('INVALID_AUDIO_TRIM'), { code: 'INVALID_AUDIO_TRIM' }); }

// Estimate each edge from the character count of any supplied word or phrase.
// No speech/text matching is performed. Source media and video timing are untouched.
export function audioTrimSeconds(text, durationSec, input = {}) {
  const settings = validateAudioTrim(input);
  if (!settings.enabled) return { start: 0, end: 0, approximate: false };
  let start = settings.startSec;
  let end = settings.endSec;
  if (settings.mode === 'phrase') {
    const source = String(text || '');
    const length = Array.from(source).length;
    const edgeLength = Array.from(settings.phrase.trim()).length;
    // The input is a length sample, not a literal match against the narration.
    if (!length) throw trimError();
    start = durationSec * edgeLength / length;
    end = start;
  }
  if (!Number.isFinite(start + end) || start + end >= durationSec) throw trimError();
  return { start, end, approximate: settings.mode === 'phrase' };
}
