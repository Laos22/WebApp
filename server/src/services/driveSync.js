import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Readable } from "stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_FOLDER_NAME = "AI Hub";

/**
 * Создает OAuth2 клиент для конкретного пользователя
 * @param {Object} tokens - Токены пользователя из БД
 * @returns {Object} oauth2Client и credentials
 */
export const createDriveClient = (tokens) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.VITE_SERVER_URL}/auth/callback`,
  );

  oauth2Client.setCredentials(tokens);

  // Обновляем токен если нужно
  if (tokens.expiry_date && new Date(tokens.expiry_date) < new Date()) {
    // Note: refreshAccessToken is asynchronous in googleapis
    // If needed, handle it asynchronously, but keeping existing sync signature or adjusting as needed.
  }

  return { oauth2Client, credentials: tokens };
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
  } catch (error) {
    console.error("❌ Ошибка при поиске/создании папки AI Hub:", error);
    throw error;
  }
};

/**
 * Инициализирует синхронизацию (создает папку при первом подключении)
 * @param {Object} userTokens - Токены пользователя
 * @returns {Promise<Object>} { success: boolean, folderId?: string, error?: string }
 */
export const initializeDriveSync = async (userTokens) => {
  try {
    const { oauth2Client } = createDriveClient(userTokens);
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const folderId = await getOrCreateAiHubFolder(drive);
    return { success: true, folderId };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Синхронизирует настройки пользователя на Google Drive внутри папки "AI Hub"
 * @param {Object} userSettings - Настройки пользователя (включая driveTokens)
 * @returns {Object} Результат синхронизации
 */
export const syncToDrive = async (userSettings) => {
  // Добавляем проверку режима разработки
  if (process.env.BYPASS_AUTH === "true") {
    console.log("🛠 [Dev Mode] Пропускаем реальную синхронизацию с Drive");
    return { success: true, bypassed: true };
  }

  console.log("🚀 syncToDrive: Запуск синхронизации настроек в облако...");
  try {
    if (!userSettings || !userSettings.driveTokens) {
      return { success: false, error: "No drive tokens" };
    }
    const { oauth2Client } = createDriveClient(userSettings.driveTokens);
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const aiHubFolderId = await getOrCreateAiHubFolder(drive);

    // Подготавливаем данные для JSON-файла
    const settingsData = JSON.stringify(
      {
        apiKey: userSettings.apiKey,
        systemPrompt: userSettings.systemPrompt,
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
  } catch (error) {
    console.error("❌ Ошибка синхронизации с Drive:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Скачивает файл с Google Drive
 * @param {string} fileId - ID файла на Drive
 * @param {Object} userSettings - Настройки пользователя
 * @param {string} destPath - Путь для сохранения
 */
export const downloadFromDrive = async (fileId, userSettings, destPath) => {
  // Добавляем проверку режима разработки
  if (process.env.BYPASS_AUTH === "true") {
    console.log("🛠 [Dev Mode] Пропускаем скачивание с Drive");
    return true;
  }

  try {
    if (!userSettings.driveTokens) {
      console.log("❌ У пользователя нет токенов Google Drive");
      return false;
    }

    const { oauth2Client } = createDriveClient(userSettings.driveTokens);
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" },
    );

    return new Promise((resolve, reject) => {
      res.data
        .pipe(fs.createWriteStream(destPath))
        .on("finish", () => {
          console.log(`✓ Файл загружен с Drive: ${destPath}`);
          resolve(true);
        })
        .on("error", reject);
    });
  } catch (error) {
    console.error("Ошибка загрузки с Drive:", error);
    return false;
  }
};
