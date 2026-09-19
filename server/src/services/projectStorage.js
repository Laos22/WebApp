import { promises as fs } from "node:fs";
import path from "node:path";

export const PROJECT_MEDIA_DIRECTORIES = [
  "audio", "images", "video", "cover", "script", "references", "packages",
];

const projectKeyPrefix = "project/";

function storageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function safeProjectFolderName(value, fallback = "project") {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function projectsRoot() {
  return path.resolve(process.env.PROJECTS_ROOT || path.join(process.cwd(), "uploads", "projects"));
}

export async function ensureProjectWorkspace(projectPath) {
  if (typeof projectPath !== "string" || !projectPath.trim()) throw storageError("INVALID_PROJECT_PATH");
  const root = path.resolve(projectPath);
  if (root === path.parse(root).root) throw storageError("INVALID_PROJECT_PATH");
  await fs.mkdir(root, { recursive: true });
  await Promise.all(PROJECT_MEDIA_DIRECTORIES.map(directory => fs.mkdir(path.join(root, directory), { recursive: true })));
  return root;
}

export async function createProjectWorkspace({ title, projectId }) {
  const root = projectsRoot();
  await fs.mkdir(root, { recursive: true });
  const folder = safeProjectFolderName(title, `project_${projectId}`);
  let target = path.join(root, folder);
  try {
    await fs.access(target);
    target = path.join(root, `${folder}_${String(projectId).slice(-6)}`);
  } catch {
    // The readable project name is available.
  }
  await ensureProjectWorkspace(target);
  return target;
}

export function projectStorageKey(directory, ...segments) {
  if (!PROJECT_MEDIA_DIRECTORIES.includes(directory) || segments.some(segment =>
    typeof segment !== "string" || !segment || segment.includes("/") || segment.includes("\\") || segment === "." || segment === "..")) {
    throw storageError("INVALID_STORAGE_KEY");
  }
  return path.posix.join("project", directory, ...segments);
}

export function isProjectStorageKey(storageKey) {
  return typeof storageKey === "string" && storageKey.startsWith(projectKeyPrefix);
}

export function resolveProjectStorageKey(projectPath, storageKey, requiredDirectory) {
  if (!isProjectStorageKey(storageKey) || path.isAbsolute(storageKey) ||
      !PROJECT_MEDIA_DIRECTORIES.includes(requiredDirectory)) throw storageError("INVALID_STORAGE_KEY");
  const relative = storageKey.slice(projectKeyPrefix.length).split("/").join(path.sep);
  if (relative !== requiredDirectory && !relative.startsWith(`${requiredDirectory}${path.sep}`)) {
    throw storageError("INVALID_STORAGE_KEY");
  }
  const root = path.resolve(projectPath || "");
  const absolute = path.resolve(root, relative);
  const within = path.relative(root, absolute);
  if (!within || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) throw storageError("INVALID_STORAGE_KEY");
  return absolute;
}
