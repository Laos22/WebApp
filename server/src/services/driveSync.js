import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import { loadDriveTokens, saveDriveTokens } from "./driveTokenService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_FOLDER_NAME = "AI Hub";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function driveSafeName(value, fallback = "project") {
  const result = String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return result || fallback;
}

async function driveForUser(userId) {
  const { oauth2Client } = await createDriveClient(userId);
  return google.drive({ version: "v3", auth: oauth2Client });
}

/** Load the owner's credentials into memory only; callers must await this factory. */
export const createDriveClient = async (userId) => {
  const { tokens } = await loadDriveTokens(userId);
  if (!tokens) throw new Error("DRIVE_CREDENTIALS_UNAVAILABLE");
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.VITE_SERVER_URL}/auth/callback`,
  );
  oauth2Client.on("tokens", (incomingTokens) => {
    void saveDriveTokens({ userId, incomingTokens }).catch(() => {
      console.error("DRIVE_REFRESH_SAVE_FAILED");
    });
  });
  oauth2Client.setCredentials(tokens);
  return { oauth2Client };
};

/**
 * Находит или создает корневую папку "AI Hub" на Google Drive пользователя
 * @param {Object} drive - Google Drive API клиент
 * @returns {Promise<string>} ID папки "AI Hub"
 */
export const getOrCreateAiHubFolder = async (drive) => {
  try {
    // Ищем существующую папку "AI Hub"
    const response = await drive.files.list({
      q: `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
      spaces: "drive",
    });

    if (response.data.files && response.data.files.length > 0) {
      const folderId = response.data.files[0].id;
      console.log(
        `📁 Найдена существующая папка "${ROOT_FOLDER_NAME}" (ID: ${folderId})`,
      );
      return folderId;
    }

    // Если папка не найдена, создаем её
    console.log(
      `📁 Создаем новую папку "${ROOT_FOLDER_NAME}" на Google Drive...`,
    );
    const folderMetadata = {
      name: ROOT_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    };

    const folder = await drive.files.create({
      requestBody: folderMetadata,
      fields: "id",
    });

    console.log(
      `✓ Папка "${ROOT_FOLDER_NAME}" успешно создана (ID: ${folder.data.id})`,
    );
    return folder.data.id;
  } catch {
    console.error("DRIVE_FOLDER_FAILED");
    throw new Error("DRIVE_FOLDER_FAILED");
  }
};

export async function getOrCreateDriveFolder(drive, name, parentId) {
  const safeName = driveSafeName(name, "folder");
  const clauses = [
    `name='${escapeDriveQueryValue(safeName)}'`,
    `mimeType='${FOLDER_MIME_TYPE}'`,
    "trashed=false",
  ];
  if (parentId) clauses.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
  const found = await drive.files.list({
    q: clauses.join(" and "),
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 10,
  });
  if (found.data.files?.[0]?.id) return found.data.files[0].id;
  const created = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: FOLDER_MIME_TYPE,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error("DRIVE_FOLDER_FAILED");
  return created.data.id;
}

export async function createDriveProjectWorkspace({ userId, title, projectId }) {
  const drive = await driveForUser(userId);
  const rootId = await getOrCreateAiHubFolder(drive);
  const projectsId = await getOrCreateDriveFolder(drive, "Projects", rootId);
  const projectFolderName = `${driveSafeName(title)}_${String(projectId).slice(-6)}`;
  const projectFolderId = await getOrCreateDriveFolder(drive, projectFolderName, projectsId);
  const folderIds = {};
  for (const name of ["audio", "images", "video", "cover", "script", "references", "packages"]) {
    folderIds[name] = await getOrCreateDriveFolder(drive, name, projectFolderId);
  }
  return { rootFolderId: projectFolderId, folderIds };
}

export function driveStorageKey(fileId) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(fileId || ""))) throw new Error("INVALID_DRIVE_FILE_ID");
  return `gdrive:${fileId}`;
}

export function driveFileIdFromStorageKey(storageKey) {
  const match = /^gdrive:([A-Za-z0-9_-]+)$/.exec(String(storageKey || ""));
  if (!match) return null;
  return match[1];
}

export async function createDriveFile({ userId, parentId, name, mimeType, buffer }) {
  if (!Buffer.isBuffer(buffer) || !parentId) throw new Error("DRIVE_FILE_INPUT_INVALID");
  const drive = await driveForUser(userId);
  const created = await drive.files.create({
    requestBody: { name: driveSafeName(name, "file"), parents: [parentId] },
    media: { mimeType: mimeType || "application/octet-stream", body: Readable.from(buffer) },
    fields: "id,name,mimeType,size,modifiedTime",
  });
  if (!created.data.id) throw new Error("DRIVE_UPLOAD_FAILED");
  return { ...created.data, storageKey: driveStorageKey(created.data.id) };
}

export async function upsertDriveFileByName({ userId, parentId, name, mimeType, buffer }) {
  if (!Buffer.isBuffer(buffer) || !parentId) throw new Error("DRIVE_FILE_INPUT_INVALID");
  const drive = await driveForUser(userId);
  const safeName = driveSafeName(name, "file");
  const found = await drive.files.list({
    q: `name='${escapeDriveQueryValue(safeName)}' and '${escapeDriveQueryValue(parentId)}' in parents and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
    pageSize: 1,
  });
  const existingId = found.data.files?.[0]?.id;
  const result = existingId
    ? await drive.files.update({
      fileId: existingId,
      media: { mimeType: mimeType || "application/octet-stream", body: Readable.from(buffer) },
      fields: "id,name,mimeType,size,modifiedTime",
    })
    : await drive.files.create({
      requestBody: { name: safeName, parents: [parentId] },
      media: { mimeType: mimeType || "application/octet-stream", body: Readable.from(buffer) },
      fields: "id,name,mimeType,size,modifiedTime",
    });
  if (!result.data.id) throw new Error("DRIVE_UPLOAD_FAILED");
  return { ...result.data, storageKey: driveStorageKey(result.data.id) };
}

export async function readDriveFileByName({ userId, parentId, name }) {
  if (!parentId) throw new Error("DRIVE_FILE_INPUT_INVALID");
  const drive = await driveForUser(userId);
  const safeName = driveSafeName(name, "file");
  const found = await drive.files.list({
    q: `name='${escapeDriveQueryValue(safeName)}' and '${escapeDriveQueryValue(parentId)}' in parents and trashed=false`,
    fields: "files(id)", spaces: "drive", pageSize: 1,
  });
  const fileId = found.data.files?.[0]?.id;
  if (!fileId) return null;
  const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
}

export async function readDriveFile({ userId, storageKey }) {
  const fileId = driveFileIdFromStorageKey(storageKey);
  if (!fileId) throw new Error("INVALID_DRIVE_FILE_ID");
  const drive = await driveForUser(userId);
  const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
}

export async function trashDriveFile({ userId, storageKey }) {
  const fileId = driveFileIdFromStorageKey(storageKey);
  if (!fileId) return false;
  const drive = await driveForUser(userId);
  await drive.files.update({ fileId, requestBody: { trashed: true } });
  return true;
}

export async function trashDriveFolder({ userId, folderId }) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(folderId || ""))) return false;
  const drive = await driveForUser(userId);
  await drive.files.update({ fileId: folderId, requestBody: { trashed: true } });
  return true;
}

/**
 * Инициализирует синхронизацию (создает папку при первом подключении)
 * @param {string|Object} userId - ID владельца Settings
 * @returns {Promise<Object>} { success: boolean, folderId?: string, error?: string }
 */
export const initializeDriveSync = async (userId) => {
  try {
    const { oauth2Client } = await createDriveClient(userId);
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const folderId = await getOrCreateAiHubFolder(drive);
    return { success: true, folderId };
  } catch {
    return { success: false, error: "DRIVE_INITIALIZE_FAILED" };
  }
};

/**
 * Синхронизирует настройки пользователя на Google Drive внутри папки "AI Hub"
 * @param {Object} userSettings - Настройки пользователя с userId
 * @returns {Object} Результат синхронизации
 */
export const syncToDrive = async (userSettings) => {
  console.log("🚀 syncToDrive: Запуск синхронизации настроек в облако...");
  try {
    const { oauth2Client } = await createDriveClient(userSettings?.userId);
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const aiHubFolderId = await getOrCreateAiHubFolder(drive);

    // Подготавливаем данные для JSON-файла
    const settingsData = JSON.stringify(
      {
        prompts: userSettings.prompts,
        updatedAt: userSettings.updatedAt,
      },
      null,
      2,
    );
    const fileStream = Readable.from(settingsData);
    const fileName = "app-settings.json";

    if (userSettings.driveFileId) {
      try {
        await drive.files.update({
          fileId: userSettings.driveFileId,
          media: { mimeType: "application/json", body: fileStream },
        });
        console.log(
          `✓ Настройки обновлены на Drive (ID: ${userSettings.driveFileId})`,
        );
        return { success: true, fileId: userSettings.driveFileId };
      } catch (e) {
        console.warn("⚠️ Файл на Drive не найден, создаем новый...");
      }
    }
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: "application/json",
        parents: [aiHubFolderId],
      },
      media: { mimeType: "application/json", body: fileStream },
    });

    console.log(`✓ Настройки созданы на Drive. ID: ${res.data.id}`);
    return { success: true, fileId: res.data.id };
  } catch {
    console.error("DRIVE_SYNC_FAILED");
    return { success: false, error: "DRIVE_SYNC_FAILED" };
  }
};

/**
 * Скачивает файл с Google Drive
 * @param {string} fileId - ID файла на Drive
 * @param {Object} userSettings - Настройки пользователя
 * @param {string} destPath - Путь для сохранения
 */
export const downloadFromDrive = async (fileId, userSettings, destPath) => {
  try {
    const { oauth2Client } = await createDriveClient(userSettings?.userId);
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" },
    );

    return await new Promise((resolve, reject) => {
      res.data
        .on("error", reject)
        .pipe(fs.createWriteStream(destPath))
        .on("finish", () => {
          console.log(`✓ Файл загружен с Drive: ${destPath}`);
          resolve(true);
        })
        .on("error", reject);
    });
  } catch {
    console.error("DRIVE_DOWNLOAD_FAILED");
    return false;
  }
};
