import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'uploads', 'voiceover');
const projectPattern = /^[a-f\d]{24}$/i;
const blockPattern = /^voice_block_[0-9a-f-]{36}$/i;

function safe(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('Unsafe audio path');
  return value;
}

export async function saveVoiceoverAudio({ projectId, blockId, buffer }) {
  const project = safe(projectId, projectPattern);
  const block = safe(blockId, blockPattern);
  const directory = path.join(ROOT, project);
  await fs.mkdir(directory, { recursive: true });
  const filename = `${block}.mp3`;
  const absolute = path.join(directory, filename);
  await fs.writeFile(absolute, buffer);
  return { storageKey: path.posix.join('voiceover', project, filename), byteSize: buffer.length };
}

export async function readVoiceoverAudio(storageKey) {
  if (typeof storageKey !== 'string' || !storageKey.startsWith('voiceover/')) throw new Error('Unsafe audio key');
  const absolute = path.resolve(process.cwd(), 'uploads', storageKey);
  const root = path.resolve(ROOT);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error('Unsafe audio key');
  return fs.readFile(absolute);
}
