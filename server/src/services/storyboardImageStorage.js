import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { detectImageFormat } from "./visualReferenceStorage.js";
import {
  ensureProjectWorkspace, isProjectStorageKey, projectStorageKey, resolveProjectStorageKey,
} from "./projectStorage.js";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const IMAGES_ROOT = path.join(UPLOADS_ROOT, "storyboard-images");
const projectIdPattern = /^[a-f\d]{24}$/i;
const frameIdPattern = /^frame_[0-9a-f-]{8,72}$/i;

function storageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeSegment(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw storageError("INVALID_STORAGE_KEY");
  return value;
}

export function resolveStoryboardImageStorageKey(storageKey) {
  if (typeof storageKey !== "string" || !storageKey || path.isAbsolute(storageKey)) {
    throw storageError("INVALID_STORAGE_KEY");
  }
  const absolutePath = path.resolve(UPLOADS_ROOT, storageKey.split("/").join(path.sep));
  const relativePath = path.relative(UPLOADS_ROOT, absolutePath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath) ||
      !relativePath.split(path.sep).join("/").startsWith("storyboard-images/")) {
    throw storageError("INVALID_STORAGE_KEY");
  }
  return absolutePath;
}

export function storyboardFrameFileBase(project, frame) {
  const voiceoverBlocks = project?.voiceover?.blocks || [];
  const storyboardFrames = project?.storyboard?.frames || [];
  const block = voiceoverBlocks.find(item => item.id === frame?.sourceVoiceoverBlockId);
  const blockOrder = block?.order || 1;
  const frameInBlock = storyboardFrames
    .filter(item => item.sourceVoiceoverBlockId === frame?.sourceVoiceoverBlockId)
    .findIndex(item => item.id === frame?.id) + 1;
  if (!Number.isSafeInteger(blockOrder) || blockOrder < 1 || frameInBlock < 1) {
    throw storageError("INVALID_STORYBOARD_FRAME_POSITION");
  }
  return `frame_${blockOrder}_${frameInBlock}`;
}

export async function saveStoryboardImageFile({ projectId, frameId, projectPath, fileBaseName, buffer }) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 15 * 1024 * 1024) throw storageError("INVALID_IMAGE_FILE");
  const format = detectImageFormat(buffer);
  let directory;
  let filename;
  let storageKey;
  if (projectPath && fileBaseName) {
    if (!/^frame_\d+_\d+$/.test(fileBaseName)) throw storageError("INVALID_STORAGE_KEY");
    const root = await ensureProjectWorkspace(projectPath);
    directory = path.join(root, "images");
    filename = `${fileBaseName}.${format.extension}`;
    storageKey = projectStorageKey("images", filename);
  } else {
    const safeProjectId = safeSegment(projectId, projectIdPattern);
    const safeFrameId = safeSegment(frameId, frameIdPattern);
    directory = path.join(IMAGES_ROOT, safeProjectId, safeFrameId);
    filename = `${randomUUID()}.${format.extension}`;
    storageKey = path.posix.join("storyboard-images", safeProjectId, safeFrameId, filename);
  }
  const targetPath = path.join(directory, filename);
  const temporaryPath = path.join(directory, `.${randomUUID()}.tmp`);
  const backupPath = path.join(directory, `.${filename}.${randomUUID()}.backup`);
  let hasBackup = false;
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporaryPath, buffer, { flag: "wx" });
    try {
      await fs.rename(targetPath, backupPath);
      hasBackup = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.rename(temporaryPath, targetPath);
  } catch {
    await fs.unlink(temporaryPath).catch(() => {});
    if (hasBackup) await fs.rename(backupPath, targetPath).catch(() => {});
    throw storageError("STORYBOARD_IMAGE_STORAGE_FAILED");
  }
  return {
    storageKey,
    mimeType: format.mimeType,
    byteSize: buffer.length,
    filename,
    _targetPath: targetPath,
    _backupPath: hasBackup ? backupPath : "",
  };
}

export async function commitStoryboardImageFile(storedFile) {
  if (storedFile?._backupPath) await fs.unlink(storedFile._backupPath).catch(() => {});
}

export async function rollbackStoryboardImageFile(storedFile) {
  if (!storedFile?._targetPath) return;
  await fs.unlink(storedFile._targetPath).catch(error => {
    if (error.code !== "ENOENT") throw storageError("STORYBOARD_IMAGE_STORAGE_FAILED");
  });
  if (storedFile._backupPath) {
    await fs.rename(storedFile._backupPath, storedFile._targetPath).catch(error => {
      if (error.code !== "ENOENT") throw storageError("STORYBOARD_IMAGE_STORAGE_FAILED");
    });
  }
}

export async function readStoryboardImageFile(storageKey, projectPath = "") {
  try {
    const absolute = isProjectStorageKey(storageKey)
      ? resolveProjectStorageKey(projectPath, storageKey, "images")
      : resolveStoryboardImageStorageKey(storageKey);
    return await fs.readFile(absolute);
  } catch (error) {
    if (error.code === "ENOENT") throw storageError("STORYBOARD_IMAGE_FILE_NOT_FOUND");
    if (error.code === "INVALID_STORAGE_KEY") throw error;
    throw storageError("STORYBOARD_IMAGE_STORAGE_FAILED");
  }
}

export async function deleteStoryboardImageFile(storageKey, projectPath = "") {
  if (!storageKey) return;
  try {
    const absolute = isProjectStorageKey(storageKey)
      ? resolveProjectStorageKey(projectPath, storageKey, "images")
      : resolveStoryboardImageStorageKey(storageKey);
    await fs.unlink(absolute);
  } catch (error) {
    if (!["ENOENT", "INVALID_STORAGE_KEY"].includes(error.code)) {
      throw storageError("STORYBOARD_IMAGE_STORAGE_FAILED");
    }
  }
}
