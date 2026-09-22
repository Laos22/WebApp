import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectStorageKey } from './projectStorage.js';
import { projectUsesDrive, saveProjectAsset, readProjectAsset, deleteProjectAsset } from './projectStorageGateway.js';

export const videoStorageGateway = {
  projectUsesDrive,
  saveProjectAsset,
  readProjectAsset,
  deleteProjectAsset,
};

function fail(code) { throw Object.assign(new Error(code), { code }); }
const filenamePattern = /^video_[1-9]\d*_[1-9]\d*(?:__[0-9a-zA-Z_-]{1,72})?\.mp4$/;
const remotePattern = /^gdrive:[A-Za-z0-9_-]+$/;
export function storyboardVideoFilename(project, frameId, uniqueSuffix = '') {
  const frame = project.storyboard?.frames?.find(item => item.id === frameId);
  const block = project.voiceover?.blocks?.find(item => item.id === frame?.sourceVoiceoverBlockId);
  const index = project.storyboard?.frames?.filter(item => item.sourceVoiceoverBlockId === block?.id)
    .findIndex(item => item.id === frameId);
  if (!frame || !block || !Number.isSafeInteger(block.order) || block.order < 1 || index < 0) fail('INVALID_STORYBOARD_FRAME_POSITION');
  const suffix = uniqueSuffix ? `__${uniqueSuffix}` : '';
  return `video_${block.order}_${index + 1}${suffix}.mp4`;
}
export function resolveStoryboardVideoStorageKey(storageKey, projectPath) {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath) || projectPath === path.parse(projectPath).root ||
      typeof storageKey !== 'string' || !storageKey.startsWith('project/video/') ||
      !filenamePattern.test(storageKey.slice('project/video/'.length))) fail('INVALID_STORAGE_KEY');
  return path.join(projectPath, 'video', storageKey.slice('project/video/'.length));
}
async function localTarget(storageKey, projectPath, create = false) {
  const target = resolveStoryboardVideoStorageKey(storageKey, projectPath);
  const root = await fs.realpath(projectPath);
  const directory = path.join(root, 'video');
  if (create) await fs.mkdir(directory, { recursive: true });
  if ((await fs.lstat(directory)).isSymbolicLink() || await fs.realpath(directory) !== directory) fail('INVALID_STORAGE_KEY');
  try { if (!(await fs.lstat(target)).isFile()) fail('INVALID_STORAGE_KEY'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return path.join(directory, path.basename(target));
}

// Save -> persist the database record -> commit. On persistence failure use rollback.
// Remote uploads create a new Drive file; the old file survives until commit.
export async function saveStoryboardVideoFile({ project, userId, frameId, buffer, previousStorageKey = '', unique = false }) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') fail('INVALID_VIDEO_FILE');
  const uniqueSuffix = unique ? (typeof unique === 'string' ? unique : randomUUID()) : '';
  const filename = storyboardVideoFilename(project, frameId, uniqueSuffix);
  if (videoStorageGateway.projectUsesDrive(project)) {
    if (previousStorageKey && !remotePattern.test(previousStorageKey)) fail('INVALID_STORAGE_KEY');
    const stored = await videoStorageGateway.saveProjectAsset({ project, userId, directory: 'video', filename, mimeType: 'video/mp4', buffer });
    return { storageKey: stored.storageKey, filename, mimeType: 'video/mp4', byteSize: buffer.length,
      _remote: true, _userId: userId, _previousStorageKey: previousStorageKey };
  }
  const storageKey = projectStorageKey('video', filename);
  const target = await localTarget(storageKey, project.projectPath, true);
  const temporary = path.join(path.dirname(target), `.${randomUUID()}.tmp`);
  const backup = path.join(path.dirname(target), `.${randomUUID()}.backup`);
  let backedUp = false;
  try {
    await fs.writeFile(temporary, buffer, { flag: 'wx' });
    if (unique) {
      // A unique import must never replace an existing target, even if a
      // generated suffix collides. link() is exclusive and atomic on the
      // same filesystem; rename() would silently overwrite the target.
      try {
        await fs.link(temporary, target);
      } catch (error) {
        if (error.code === 'EEXIST') fail('VIDEO_STORAGE_COLLISION');
        throw error;
      }
      await fs.unlink(temporary);
      return { storageKey, filename, mimeType: 'video/mp4', byteSize: buffer.length,
        _target: target, _backup: '' };
    }
    try { await fs.copyFile(target, backup, fs.constants.COPYFILE_EXCL); backedUp = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    if (backedUp) await fs.unlink(backup).catch(() => {});
    throw error;
  }
  return { storageKey, filename, mimeType: 'video/mp4', byteSize: buffer.length,
    _target: target, _backup: backedUp ? backup : '' };
}
export async function commitStoryboardVideoFile(stored) {
  if (stored._remote) {
    if (stored._previousStorageKey && stored._previousStorageKey !== stored.storageKey)
      await videoStorageGateway.deleteProjectAsset({ storageKey: stored._previousStorageKey, userId: stored._userId });
  } else if (stored._backup) await fs.unlink(stored._backup);
}
export async function rollbackStoryboardVideoFile(stored) {
  if (stored._remote) return videoStorageGateway.deleteProjectAsset({ storageKey: stored.storageKey, userId: stored._userId });
  if (stored._backup) await fs.rename(stored._backup, stored._target);
  else await fs.unlink(stored._target);
}
export async function readStoryboardVideoFile(storageKey, projectPath, userId) {
  if (remotePattern.test(storageKey)) return videoStorageGateway.readProjectAsset({ storageKey, userId });
  return fs.readFile(await localTarget(storageKey, projectPath));
}
export async function deleteStoryboardVideoFile(storageKey, projectPath, userId) {
  if (remotePattern.test(storageKey)) return videoStorageGateway.deleteProjectAsset({ storageKey, userId });
  try { await fs.unlink(await localTarget(storageKey, projectPath)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
