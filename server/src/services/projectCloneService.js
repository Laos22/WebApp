import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import VisualReference from '../models/VisualReference.js';
import StoryboardImage from '../models/StoryboardImage.js';
import StoryboardVideo from '../models/StoryboardVideo.js';
import ShortVideo from '../models/ShortVideo.js';
import StoryboardGeneration from '../models/StoryboardGeneration.js';
import { copyDriveProjectWorkspace, driveFileIdFromStorageKey } from './driveSync.js';
import { deleteProjectWorkspace, initializeProjectStorage, projectUsesDrive, saveProjectAsset, updateProjectState } from './projectStorageGateway.js';
import { ensureProjectWorkspace, projectStorageKey } from './projectStorage.js';
import { readVoiceoverAudio } from './voiceoverStorage.js';
import { readVisualReferenceFile } from './visualReferenceStorage.js';
import { readStoryboardImageFile } from './storyboardImageStorage.js';

const relatedModels = [VisualReference, StoryboardImage, StoryboardVideo, ShortVideo, StoryboardGeneration];

export function copyProjectName(original, existing) {
  const base = String(original || 'Проект').replace(/ \(копия(?: \d+)?\)$/u, '');
  const used = new Set(existing);
  if (!used.has(`${base} (копия)`)) return `${base} (копия)`;
  let number = 2;
  while (used.has(`${base} (копия ${number})`)) number += 1;
  return `${base} (копия ${number})`;
}

export async function remapProjectStorageKeys(value, replace) {
  if (Array.isArray(value)) return Promise.all(value.map(item => remapProjectStorageKeys(item, replace)));
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
  const mapped = {};
  for (const [key, entry] of Object.entries(value)) {
    mapped[key] = /storageKey$/i.test(key) && typeof entry === 'string' && entry
      ? await replace(entry)
      : await remapProjectStorageKeys(entry, replace);
  }
  return mapped;
}

async function copyLegacyAsset({ key, source, target, userId }) {
  let directory;
  let buffer;
  if (key.startsWith('voiceover/')) {
    directory = 'audio';
    buffer = await readVoiceoverAudio(key, source.projectPath, userId);
  } else if (key.startsWith('visual-references/')) {
    directory = 'references';
    buffer = await readVisualReferenceFile(key, source.projectPath, userId);
  } else if (key.startsWith('storyboard-images/')) {
    directory = 'images';
    buffer = await readStoryboardImageFile(key, source.projectPath, userId);
  } else {
    throw new Error('PROJECT_COPY_UNSUPPORTED_MEDIA');
  }
  const extension = path.extname(key).toLowerCase();
  if (!['.mp3', '.jpg', '.jpeg', '.png', '.webp'].includes(extension)) throw new Error('PROJECT_COPY_UNSUPPORTED_MEDIA');
  const filename = `copied_${randomUUID()}${extension}`;
  if (projectUsesDrive(target)) {
    const mimeType = extension === '.mp3' ? 'audio/mpeg' : extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    const stored = await saveProjectAsset({ project: target, userId, directory, filename, mimeType, buffer });
    return stored.storageKey;
  }
  const root = await ensureProjectWorkspace(target.projectPath);
  await fs.writeFile(path.join(root, directory, filename), buffer, { flag: 'wx' });
  return projectStorageKey(directory, filename);
}

export async function cloneProject(sourceId, userId) {
  const source = await Project.collection.findOne({ _id: new mongoose.Types.ObjectId(sourceId), userId });
  if (!source) return null;
  const activeGeneration = await StoryboardGeneration.collection.findOne({ projectId: source._id, userId, status: { $in: ['queued', 'running'] } });
  if (activeGeneration) throw Object.assign(new Error('Дождитесь завершения или остановите генерацию раскадровки.'), { status: 409 });
  const names = await Project.collection.find({ userId }, { projection: { title: 1, shortTitle: 1 } }).toArray();
  const title = copyProjectName(source.title, names.map(item => item.title));
  const shortTitle = copyProjectName(source.shortTitle || source.title, names.map(item => item.shortTitle));
  const newId = new mongoose.Types.ObjectId();
  const storage = await initializeProjectStorage({ title: shortTitle, projectId: newId.toString(), userId, provider: source.storage?.provider });
  const target = { projectPath: storage.projectPath, storage: storage.storage };
  const inserted = [];
  try {
    let driveIds = new Map();
    if (projectUsesDrive(target)) {
      driveIds = await copyDriveProjectWorkspace({ userId, sourceStorage: source.storage, targetStorage: target.storage });
    } else {
      if (!source.projectPath || path.resolve(source.projectPath) === path.resolve(target.projectPath)) throw new Error('PROJECT_COPY_INVALID_PATH');
      await fs.cp(source.projectPath, target.projectPath, { recursive: true, force: true });
    }
    const knownKeys = new Map();
    const replaceKey = async key => {
      if (knownKeys.has(key)) return knownKeys.get(key);
      let copied;
      const driveId = driveFileIdFromStorageKey(key);
      if (driveId) {
        const targetId = driveIds.get(driveId);
        if (!targetId) throw new Error('PROJECT_COPY_MISSING_MEDIA');
        copied = `gdrive:${targetId}`;
      } else if (key.startsWith('project/')) {
        if (projectUsesDrive(target)) throw new Error('PROJECT_COPY_UNSUPPORTED_MEDIA');
        const relative = key.slice('project/'.length);
        const absolute = path.resolve(target.projectPath, relative);
        if (!absolute.startsWith(`${path.resolve(target.projectPath)}${path.sep}`)) throw new Error('PROJECT_COPY_UNSUPPORTED_MEDIA');
        await fs.access(absolute);
        copied = key;
      } else {
        copied = await copyLegacyAsset({ key, source, target, userId });
      }
      knownKeys.set(key, copied);
      return copied;
    };
    const now = new Date();
    const newProject = await remapProjectStorageKeys(source, replaceKey);
    Object.assign(newProject, { _id: newId, title, shortTitle, projectPath: target.projectPath,
      storage: target.storage, createdAt: now, updatedAt: now, storyboardGenerationRunId: '' });
    newProject.scriptPath = source.projectPath && source.scriptPath?.startsWith(`${source.projectPath}${path.sep}`)
      ? path.join(target.projectPath, path.relative(source.projectPath, source.scriptPath)) : '';
    const collections = [];
    for (const Model of relatedModels) {
      const docs = await Model.collection.find({ projectId: source._id, userId,
        ...(Model === StoryboardGeneration ? { status: { $ne: 'completed' } } : {}) }).toArray();
      collections.push({ Model, docs: await Promise.all(docs.map(async doc => ({
        ...await remapProjectStorageKeys(doc, replaceKey), _id: new mongoose.Types.ObjectId(), projectId: newId,
        ...(Model === StoryboardGeneration ? { runId: randomUUID(), leaseToken: '', leaseUntil: null } : {}),
      }))) });
    }
    // The project becomes visible only after its related records and files exist.
    for (const { Model, docs } of collections) {
      if (docs.length) {
        inserted.push(Model);
        await Model.collection.insertMany(docs);
      }
    }
    await Project.collection.insertOne(newProject);
    inserted.push(Project);
    await updateProjectState({ project: target, userId, patch: { short_title: shortTitle } });
    return { projectId: newId, title, shortTitle };
  } catch (error) {
    await Promise.all(inserted.map(Model => Model.collection.deleteMany(Model === Project
      ? { _id: newId, userId } : { projectId: newId, userId })).map(promise => promise.catch(() => {})));
    await deleteProjectWorkspace({ project: target, userId }).catch(() => {});
    throw error;
  }
}
