import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureProjectWorkspace, projectStorageKey, resolveProjectStorageKey } from './projectStorage.js';
import { saveProjectAsset, readProjectAsset, deleteProjectAsset, projectUsesDrive } from './projectStorageGateway.js';

const filenamePattern = /^short_[a-f0-9]{24}_[a-f0-9]{32}\.mp3$/;

export async function saveShortAudio({ project, userId, shortId, buffer }) {
  if (!/^[a-f0-9]{24}$/.test(String(shortId)) || !Buffer.isBuffer(buffer) || !buffer.length) throw new Error('INVALID_SHORT_AUDIO');
  const filename = `short_${shortId}_${randomUUID().replaceAll('-', '')}.mp3`;
  if (projectUsesDrive(project)) {
    const stored = await saveProjectAsset({ project, userId, directory: 'audio', filename,
      mimeType: 'audio/mpeg', buffer });
    return { filename, storageKey: stored.storageKey };
  }
  const root = await ensureProjectWorkspace(project.projectPath);
  const target = path.join(root, 'audio', filename);
  await fs.writeFile(target, buffer, { flag: 'wx' });
  return { filename, storageKey: projectStorageKey('audio', filename) };
}

export async function readShortAudio({ project, userId, storageKey, filename }) {
  if (!filenamePattern.test(String(filename || ''))) throw new Error('INVALID_SHORT_AUDIO');
  const remote = await readProjectAsset({ userId, storageKey });
  if (remote) return remote;
  if (storageKey !== projectStorageKey('audio', filename)) throw new Error('INVALID_SHORT_AUDIO');
  return fs.readFile(resolveProjectStorageKey(project.projectPath, storageKey, 'audio'));
}

export async function deleteShortAudio({ project, userId, storageKey, filename }) {
  if (!filenamePattern.test(String(filename || '')) || !storageKey) return;
  if (await deleteProjectAsset({ userId, storageKey })) return;
  if (storageKey !== projectStorageKey('audio', filename)) return;
  await fs.unlink(resolveProjectStorageKey(project.projectPath, storageKey, 'audio')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}
