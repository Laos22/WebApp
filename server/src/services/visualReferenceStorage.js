import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_VISUAL_REFERENCE_BYTES = 15 * 1024 * 1024;
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const REFERENCES_ROOT = path.join(UPLOADS_ROOT, "visual-references");
const projectIdPattern = /^[a-f\d]{24}$/i;
const entityCollectionPattern = /^(characters|locations|objects)$/;
const entityIdPattern = /^(char|loc|obj)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function storageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeSegment(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw storageError("INVALID_STORAGE_KEY");
  return value;
}

export function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_VISUAL_REFERENCE_BYTES) {
    throw storageError("INVALID_IMAGE_FILE");
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).equals(Buffer.from("RIFF")) &&
      buffer.subarray(8, 12).equals(Buffer.from("WEBP"))) {
    return { extension: "webp", mimeType: "image/webp" };
  }
  throw storageError("INVALID_IMAGE_FILE");
}

export function resolveVisualReferenceStorageKey(storageKey) {
  if (typeof storageKey !== "string" || path.isAbsolute(storageKey)) throw storageError("INVALID_STORAGE_KEY");
  const normalized = storageKey.split("/").join(path.sep);
  const absolutePath = path.resolve(UPLOADS_ROOT, normalized);
  const relativePath = path.relative(UPLOADS_ROOT, absolutePath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath) ||
      !relativePath.split(path.sep).join("/").startsWith("visual-references/")) {
    throw storageError("INVALID_STORAGE_KEY");
  }
  return absolutePath;
}

export async function saveVisualReferenceFile({ projectId, entityCollection, entityId, buffer }) {
  const safeProjectId = safeSegment(projectId, projectIdPattern);
  const safeCollection = safeSegment(entityCollection, entityCollectionPattern);
  const safeEntityId = safeSegment(entityId, entityIdPattern);
  const format = detectImageFormat(buffer);
  const directory = path.join(REFERENCES_ROOT, safeProjectId, safeCollection, safeEntityId);
  const filename = `${randomUUID()}.${format.extension}`;
  const targetPath = path.join(directory, filename);
  const temporaryPath = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporaryPath, buffer, { flag: "wx" });
    await fs.rename(temporaryPath, targetPath);
  } catch {
    await fs.unlink(temporaryPath).catch(() => {});
    throw storageError("VISUAL_REFERENCE_STORAGE_FAILED");
  }
  return {
    storageKey: path.posix.join("visual-references", safeProjectId, safeCollection, safeEntityId, filename),
    mimeType: format.mimeType,
    byteSize: buffer.length,
  };
}

export async function readVisualReferenceFile(storageKey) {
  try {
    return await fs.readFile(resolveVisualReferenceStorageKey(storageKey));
  } catch (error) {
    if (error.code === "ENOENT") throw storageError("VISUAL_REFERENCE_FILE_NOT_FOUND");
    if (error.code === "INVALID_STORAGE_KEY") throw error;
    throw storageError("VISUAL_REFERENCE_STORAGE_FAILED");
  }
}

export async function deleteVisualReferenceFile(storageKey) {
  try {
    await fs.unlink(resolveVisualReferenceStorageKey(storageKey));
  } catch (error) {
    if (!["ENOENT", "INVALID_STORAGE_KEY"].includes(error.code)) throw storageError("VISUAL_REFERENCE_STORAGE_FAILED");
  }
}