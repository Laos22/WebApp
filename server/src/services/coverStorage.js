import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Project from '../models/Project.js';
import { projectStorageKey, ensureProjectWorkspace } from './projectStorage.js';
import { projectUsesDrive, saveProjectAsset, readProjectAsset, deleteProjectAsset } from './projectStorageGateway.js';
import { validateCoverImage, coverError } from './coverService.js';

async function coverDirectory(project) {
  if (!project.projectPath) throw coverError(400, 'У проекта не настроена папка хранения.');
  const root = await ensureProjectWorkspace(project.projectPath);
  const directory = path.join(root, 'cover');
  const [realRoot, realDirectory, info] = await Promise.all([fs.realpath(root), fs.realpath(directory), fs.lstat(directory)]);
  if (info.isSymbolicLink() || realDirectory !== path.join(realRoot, 'cover')) throw coverError(400, 'Папка обложек недоступна для безопасного сохранения.');
  return directory;
}

export async function saveCoverToProject({ project, userId, buffer }) {
  const image = await validateCoverImage(buffer);
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[image.mimeType];
  const filename = `cover_${randomUUID()}.${extension}`;
  let storageKey, localPath;
  if (projectUsesDrive(project)) {
    const stored = await saveProjectAsset({ project, userId, directory: 'cover', filename, mimeType: image.mimeType, buffer });
    storageKey = stored.storageKey;
  } else {
    localPath = path.join(await coverDirectory(project), filename);
    try { await fs.writeFile(localPath, buffer, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') await fs.unlink(localPath).catch(() => {}); throw error; }
    storageKey = projectStorageKey('cover', filename);
  }
  const metadata = { storageKey, filename, mimeType: image.mimeType, byteSize: buffer.length, savedAt: new Date() };
  try {
    const saved = await Project.findOneAndUpdate({ _id: project._id, userId }, { $set: { coverImage: metadata } }, { returnDocument: 'after', runValidators: true });
    if (!saved) throw coverError(404, 'Проект больше недоступен.');
  } catch (error) {
    if (localPath) await fs.unlink(localPath).catch(() => {});
    else await deleteProjectAsset({ storageKey, userId }).catch(() => {});
    throw error;
  }
  // Previous saved versions stay in cover/; only the current project pointer changes.
  return metadata;
}

export async function readProjectCover(project, userId) {
  const cover = project.coverImage;
  if (!cover) throw coverError(404, 'В проекте пока нет сохранённой обложки.');
  const remote = await readProjectAsset({ storageKey: cover.storageKey, userId });
  if (remote) return remote;
  if (!/^cover_[0-9a-f-]{36}\.(png|jpg|webp)$/.test(cover.filename) || cover.storageKey !== projectStorageKey('cover', cover.filename)) throw coverError(404, 'Обложка недоступна.');
  const target = path.join(await coverDirectory(project), cover.filename);
  const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw coverError(404, 'Обложка недоступна.');
    return await handle.readFile();
  } finally { await handle.close(); }
}
