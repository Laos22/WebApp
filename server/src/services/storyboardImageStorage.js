import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { detectImageFormat } from "./visualReferenceStorage.js";

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

export async function saveStoryboardImageFile({ projectId, frameId, buffer }) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 15 * 1024 * 1024) throw storageError("INVALID_IMAGE_FILE");
  const safeProjectId = safeSegment(projectId, projectIdPattern);
  const safeFrameId = safeSegment(frameId, frameIdPattern);
  const format = detectImageFormat(buffer);
  const directory = path.join(IMAGES_ROOT, safeProjectId, safeFrameId);
  const filename = `${randomUUID()}.${format.extension}`;
  const targetPath = path.join(directory, filename);
  const temporaryPath = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporaryPath, buffer, { flag: "wx" });
    await fs.rename(temporaryPath, targetPath);
  } catch {
    await fs.unlink(temporaryPath).catch(() => {});
    throw storageError("STORYBOARD_IMAGE_STORAGE_FAILED");
  }
  return {
    storageKey: path.posix.join("storyboard-images", safeProjectId, safeFrameId, filename),
    mimeType: format.mimeType,
    byteSize: buffer.length,
  };
}

export async function readStoryboardImageFile(storageKey) {
  try {
    return await fs.readFile(resolveStoryboardImageStorageKey(storageKey));
  } catch (error) {
    if (error.code === "ENOENT") throw storageError("STORYBOARD_IMAGE_FILE_NOT_FOUND");
    if (error.code === "INVALID_STORAGE_KEY") throw error;
    throw storageError("STORYBOARD_IMAGE_STORAGE_FAILED");
  }
}

export async function deleteStoryboardImageFile(storageKey) {
  if (!storageKey) return;
  try {
    await fs.unlink(resolveStoryboardImageStorageKey(storageKey));
  } catch (error) {
    if (!["ENOENT", "INVALID_STORAGE_KEY"].includes(error.code)) {
      throw storageError("STORYBOARD_IMAGE_STORAGE_FAILED");
    }
  }
}
