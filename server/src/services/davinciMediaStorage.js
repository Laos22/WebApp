import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ensureProjectWorkspace, projectsRoot } from './projectStorage.js';

// Old local projects may still reference uploads/voiceover or UUID image names.
// Add byte-identical portable copies; never overwrite an existing project asset.
export async function ensurePortableLocalFile(projectPath, directory, filename, buffer) {
  if (!['audio', 'images', 'video'].includes(directory) || !/^((frame_\d+_\d+|still_[a-p]{64})\.(jpg|png|webp)|audio_block_\d+\.mp3|background_music_[0-9a-f-]{36}\.mp3|sound_effect_[0-9a-f-]{36}\.mp3|video_[0-9]+_[0-9]+(?:__[0-9a-f-]{36})?\.mp4)$/.test(filename)) {
    throw new Error('INVALID_DAVINCI_MEDIA_PATH');
  }
  const root = await ensureProjectWorkspace(projectPath);
  const target = path.join(root, directory, filename);
  const temporary = path.join(root, directory, `.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, buffer, { flag: 'wx' });
    try { await fs.link(temporary, target); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!(await fs.readFile(target)).equals(buffer)) {
        throw Object.assign(new Error('DAVINCI_MEDIA_NAME_CONFLICT'), { code: 'DAVINCI_MEDIA_NAME_CONFLICT' });
      }
    }
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

// Legacy uploads remain at their original storage keys. Only the project root
// is initialized; stable ID naming makes concurrent attempts use the same folder.
export async function ensureDavinciLocalWorkspace(project, persist) {
  if (project.storage?.provider === 'google_drive' || project.projectPath?.trim()) return;
  const id = String(project._id);
  if (!/^[a-f0-9]{24}$/i.test(id)) throw Object.assign(new Error('INVALID_PROJECT_ID'), { code: 'INVALID_PROJECT_ID' });
  const root = await ensureProjectWorkspace(path.join(projectsRoot(), `project_${id}`));
  await persist(root);
  project.projectPath = root;
}

export function davinciStillFilename(buffer, extension) {
  if (!['jpg', 'png', 'webp'].includes(extension)) throw new Error('INVALID_DAVINCI_IMAGE_FORMAT');
  // No numerical runs: Resolve must not discover a numbered image sequence.
  const letters = createHash('sha256').update(buffer).digest('hex').replace(/[0-9a-f]/g, char =>
    String.fromCharCode(97 + parseInt(char, 16)));
  return `still_${letters}.${extension}`;
}

export async function saveDavinciStill({ project, userId, buffer, extension, mimeType, remoteWrite }) {
  const filename = davinciStillFilename(buffer, extension);
  if (project.storage?.provider === 'google_drive') {
    const write = remoteWrite || (await import('./driveSync.js')).upsertDriveFileByName;
    await write({ userId, parentId: project.storage.driveFolderIds?.images, name: filename, mimeType, buffer, reuseExisting: true });
  } else {
    await ensurePortableLocalFile(project.projectPath, 'images', filename, buffer);
  }
  return filename;
}

export async function prepareDavinciImages(frames, prepare, onProgress = () => {}) {
  let next = 0;
  let completed = 0;
  let failure;
  const results = new Map();
  await Promise.all(Array.from({ length: Math.min(4, frames.length) }, async () => {
    while (!failure && next < frames.length) {
      const frame = frames[next++];
      try {
        results.set(frame.id, await prepare(frame));
        onProgress(++completed, frames.length);
      } catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
  return results;
}
