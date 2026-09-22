import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectStorageKey, ensureProjectWorkspace } from './projectStorage.js';
import { projectUsesDrive, saveProjectAsset, readProjectAsset, deleteProjectAsset } from './projectStorageGateway.js';

function filename(id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('INVALID_SOUND_EFFECT_ID');
  return `sound_effect_${id}.mp3`;
}

export async function saveSoundEffectFile({ project, userId, buffer, effectId = randomUUID() }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('INVALID_SOUND_EFFECT_AUDIO');
  const name = filename(effectId);
  if (projectUsesDrive(project)) {
    const stored = await saveProjectAsset({ project, userId, directory: 'audio', filename: name, mimeType: 'audio/mpeg', buffer });
    return { storageKey: stored.storageKey, filename: name, mimeType: 'audio/mpeg', byteSize: buffer.length };
  }
  const root = await ensureProjectWorkspace(project.projectPath);
  const target = path.join(root, 'audio', name);
  const temporary = path.join(root, 'audio', `.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, buffer, { flag: 'wx' });
  try { await fs.rename(temporary, target); }
  catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
  return { storageKey: projectStorageKey('audio', name), filename: name, mimeType: 'audio/mpeg', byteSize: buffer.length };
}

export async function readSoundEffectFile(storageKey, project, userId) {
  const remote = await readProjectAsset({ storageKey, userId });
  if (remote) return remote;
  if (typeof storageKey !== 'string' || !storageKey.startsWith('project/audio/')) throw new Error('INVALID_SOUND_EFFECT_STORAGE_KEY');
  const root = await ensureProjectWorkspace(project.projectPath);
  const name = storageKey.slice('project/audio/'.length);
  if (!/^sound_effect_[0-9a-f-]{36}\.mp3$/i.test(name)) throw new Error('INVALID_SOUND_EFFECT_STORAGE_KEY');
  return fs.readFile(path.join(root, 'audio', name));
}

export async function deleteSoundEffectFile(storageKey, project, userId) {
  if (!storageKey) return;
  if (await deleteProjectAsset({ storageKey, userId })) return;
  const root = await ensureProjectWorkspace(project.projectPath);
  const name = storageKey.slice('project/audio/'.length);
  if (!/^sound_effect_[0-9a-f-]{36}\.mp3$/i.test(name)) return;
  await fs.unlink(path.join(root, 'audio', name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
