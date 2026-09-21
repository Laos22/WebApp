import { parseBuffer } from 'music-metadata';

export const hasAudioDuration = value => Number.isFinite(value) && value > 0;

// Scan MPEG frames (including VBR files without a Xing header). No native binaries.
export async function measureMp3Duration(buffer) {
  const { format } = await parseBuffer(buffer, { mimeType: 'audio/mpeg', size: buffer.length }, {
    duration: true, skipCovers: true,
  });
  if (format.codec !== 'MPEG 1 Layer 3' && format.codec !== 'MPEG 2 Layer 3' && format.codec !== 'MPEG 2.5 Layer 3') {
    throw new Error('INVALID_MP3');
  }
  if (!hasAudioDuration(format.duration)) throw new Error('MP3_DURATION_UNAVAILABLE');
  return format.duration;
}

// Read even when metadata exists: a ready database record is not proof the file exists.
export async function inspectAudioBlock(block, { read, persist }) {
  let buffer;
  try { buffer = await read(block.audioStorageKey); } catch { return { available: false }; }
  if (!buffer?.length) return { available: false };
  if (hasAudioDuration(block.audioDurationSec)) return { available: true, durationSec: block.audioDurationSec, exact: true };
  let durationSec;
  try { durationSec = await measureMp3Duration(buffer); } catch {
    return { available: true, exact: false };
  }
  // Persistence failures must not silently masquerade as successful backfills.
  await persist(block, durationSec);
  block.audioDurationSec = durationSec;
  return { available: true, durationSec, exact: true };
}
