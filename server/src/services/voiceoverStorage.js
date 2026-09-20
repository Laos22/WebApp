import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ensureProjectWorkspace, isProjectStorageKey, projectStorageKey, resolveProjectStorageKey,
} from './projectStorage.js';
import {
  deleteProjectAsset, projectUsesDrive, readProjectAsset, saveProjectAsset,
} from './projectStorageGateway.js';

const ROOT = path.join(process.cwd(), 'uploads', 'voiceover');
const projectPattern = /^[a-f\d]{24}$/i;
const blockPattern = /^voice_block_[0-9a-f-]{36}$/i;

function safe(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('Unsafe audio path');
  return value;
}

export async function saveVoiceoverAudio({ projectId, blockId, blockOrder, projectPath, project, userId, buffer }) {
  if (projectUsesDrive(project)) {
    if (!Number.isSafeInteger(blockOrder) || blockOrder < 1) throw new Error('Invalid audio block order');
    const filename = `audio_block_${blockOrder}.mp3`;
    const stored = await saveProjectAsset({
      project, userId, directory: 'audio', filename, mimeType: 'audio/mpeg', buffer,
    });
    return { storageKey: stored.storageKey, byteSize: buffer.length, filename };
  }
  let directory;
  let filename;
  let storageKey;
  if (projectPath && Number.isSafeInteger(blockOrder) && blockOrder >= 1) {
    const root = await ensureProjectWorkspace(projectPath);
    directory = path.join(root, 'audio');
    filename = `audio_block_${blockOrder}.mp3`;
    storageKey = projectStorageKey('audio', filename);
  } else {
    const project = safe(projectId, projectPattern);
    const block = safe(blockId, blockPattern);
    directory = path.join(ROOT, project);
    filename = `${block}.mp3`;
    storageKey = path.posix.join('voiceover', project, filename);
  }
  await fs.mkdir(directory, { recursive: true });
  const absolute = path.join(directory, filename);
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, buffer, { flag: 'wx' });
    await fs.rename(temporary, absolute);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  return { storageKey, byteSize: buffer.length, filename };
}

export async function readVoiceoverAudio(storageKey, projectPath = '', userId = null) {
  const remote = await readProjectAsset({ storageKey, userId });
  if (remote) return remote;
  let absolute;
  if (isProjectStorageKey(storageKey)) {
    absolute = resolveProjectStorageKey(projectPath, storageKey, 'audio');
  } else {
    if (typeof storageKey !== 'string' || !storageKey.startsWith('voiceover/')) throw new Error('Unsafe audio key');
    absolute = path.resolve(process.cwd(), 'uploads', storageKey);
    const root = path.resolve(ROOT);
    if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error('Unsafe audio key');
  }
  return fs.readFile(absolute);
}

export async function deleteVoiceoverAudio(storageKey, projectPath = '', userId = null) {
  if (!storageKey) return;
  if (await deleteProjectAsset({ storageKey, userId })) return;
  let absolute;
  if (isProjectStorageKey(storageKey)) {
    absolute = resolveProjectStorageKey(projectPath, storageKey, 'audio');
  } else {
    if (typeof storageKey !== 'string' || !storageKey.startsWith('voiceover/')) return;
    absolute = path.resolve(process.cwd(), 'uploads', storageKey);
    const root = path.resolve(ROOT);
    if (!absolute.startsWith(`${root}${path.sep}`)) return;
  }
  await fs.unlink(absolute).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
