import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isGoogleDriveStorage } from "../config/runtimeConfig.js";
import { createProjectWorkspace, ensureProjectWorkspace } from "./projectStorage.js";

const isDriveStorageKey = storageKey => /^gdrive:[A-Za-z0-9_-]+$/.test(String(storageKey || ""));
const driveApi = () => import("./driveSync.js");

export function projectUsesDrive(project) {
  return project?.storage?.provider === "google_drive";
}

export async function initializeProjectStorage({ title, projectId, userId }) {
  if (isGoogleDriveStorage) {
    const { createDriveProjectWorkspace } = await driveApi();
    const driveWorkspace = await createDriveProjectWorkspace({ userId, title, projectId });
    return {
      projectPath: "",
      storage: {
        provider: "google_drive",
        driveRootFolderId: driveWorkspace.rootFolderId,
        driveFolderIds: driveWorkspace.folderIds,
      },
    };
  }
  const projectPath = await createProjectWorkspace({ title, projectId });
  return { projectPath, storage: { provider: "local" } };
}

function driveFolderId(project, directory) {
  const id = directory
    ? project?.storage?.driveFolderIds?.[directory]
    : project?.storage?.driveRootFolderId;
  if (!id) throw new Error(`DRIVE_${String(directory).toUpperCase()}_FOLDER_UNAVAILABLE`);
  return id;
}

export async function saveProjectAsset({ project, userId, directory, filename, mimeType, buffer }) {
  if (!projectUsesDrive(project)) return null;
  const { createDriveFile } = await driveApi();
  return createDriveFile({
    userId,
    parentId: driveFolderId(project, directory),
    name: filename,
    mimeType,
    buffer,
  });
}

export async function readProjectAsset({ storageKey, userId }) {
  if (!isDriveStorageKey(storageKey)) return null;
  const { readDriveFile } = await driveApi();
  return readDriveFile({ userId, storageKey });
}

export async function deleteProjectAsset({ storageKey, userId }) {
  if (!isDriveStorageKey(storageKey)) return false;
  const { trashDriveFile } = await driveApi();
  return trashDriveFile({ userId, storageKey });
}

export async function writeProjectTextFile({ project, userId, directory, filename, content, mimeType = "text/plain" }) {
  const buffer = Buffer.from(String(content), "utf8");
  if (projectUsesDrive(project)) {
    const { upsertDriveFileByName } = await driveApi();
    return upsertDriveFileByName({
      userId,
      parentId: driveFolderId(project, directory),
      name: filename,
      mimeType,
      buffer,
    });
  }
  const root = await ensureProjectWorkspace(project.projectPath);
  const targetDirectory = directory ? path.join(root, directory) : root;
  await fs.mkdir(targetDirectory, { recursive: true });
  const target = path.join(targetDirectory, filename);
  const temporary = path.join(targetDirectory, `.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, buffer, { flag: "wx" });
  await fs.rename(temporary, target);
  return { storageKey: target, size: buffer.length };
}

export async function readProjectTextFile({ project, userId, directory, filename }) {
  if (projectUsesDrive(project)) {
    const { readDriveFileByName } = await driveApi();
    const buffer = await readDriveFileByName({
      userId, parentId: driveFolderId(project, directory), name: filename,
    });
    return buffer ? buffer.toString("utf8") : null;
  }
  if (!project?.projectPath) return null;
  try {
    return await fs.readFile(path.join(project.projectPath, directory || "", filename), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeProjectState({ project, userId, state }) {
  return writeProjectTextFile({
    project,
    userId,
    directory: "",
    filename: "project_state.json",
    content: JSON.stringify(state, null, 2),
    mimeType: "application/json",
  });
}

export async function updateProjectState({ project, userId, patch }) {
  let state = {};
  try {
    const current = await readProjectTextFile({
      project, userId, directory: "", filename: "project_state.json",
    });
    if (current) state = JSON.parse(current);
  } catch {
    state = {};
  }
  return writeProjectState({ project, userId, state: { ...state, ...patch } });
}

export async function deleteProjectWorkspace({ project, userId }) {
  if (projectUsesDrive(project)) {
    const { trashDriveFolder } = await driveApi();
    return trashDriveFolder({ userId, folderId: project.storage.driveRootFolderId });
  }
  if (!project?.projectPath) return false;
  await fs.rm(project.projectPath, { recursive: true, force: true });
  return true;
}
