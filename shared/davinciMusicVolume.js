export const DEFAULT_BACKGROUND_MUSIC_VOLUME = 0.3;

export function validBackgroundMusicVolume(value) {
  return Number.isFinite(value) && value >= 0.01 && value <= 1;
}

export function backgroundMusicDecibels(volume) {
  if (!validBackgroundMusicVolume(volume)) throw new RangeError('Invalid background music volume');
  const decibels = Math.round(20 * Math.log10(volume) * 100) / 100;
  return `${Object.is(decibels, -0) ? 0 : decibels}dB`;
}
