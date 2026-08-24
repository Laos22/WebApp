import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Readable } from "stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Создает OAuth2 клиент для конкретного пользователя
 * @param {Object} tokens - Токены пользователя из БД
 * @returns {Object} oauth2Client и credentials
 */
export const createDriveClient = (tokens) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.SERVER_URL}/auth/callback`,
  );

  oauth2Client.setCredentials(tokens);

  // Обновляем токен если нужно
  if (tokens.expiry_date && new Date(tokens.expiry_date) < new Date()) {
    const { credentials } = oauth2Client.refreshAccessToken();
    return { oauth2Client, credentials };
  }

  return { oauth2Client, credentials: tokens };
};

/**
 * Синхронизирует файл на Google Drive для конкретного пользователя
 * @param {string} filePath - путь к локальному файлу
 * @param {Object} userSettings - Настройки пользователя из БД
 * @returns {Object} Результат синхронизации
 */
export const syncToDrive = async (filePath, userSettings) => {
  try {
    if (!userSettings.driveTokens) {
      console.log("❌ У пользователя нет токенов Google Drive");
      return { success: false, error: "No drive tokens" };
    }

    const { oauth2Client } = createDriveClient(userSettings.driveTokens);

    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const fileName = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const fileStream = Readable.from(fileBuffer);

    if (userSettings.driveFileId) {
      // Обновляем существующий файл
      console.log(
        `🔄 Обновляем файл на Drive: ${fileName} (ID: ${userSettings.driveFileId})`,
      );
      await drive.files.update({
        fileId: userSettings.driveFileId,
        media: {
          mimeType: "application/json",
          body: fileStream,
        },
      });
      console.log(`✓ Файл ${fileName} успешно обновлен на Drive`);
      return { success: true, fileId: userSettings.driveFileId };
    } else {
      // Создаем новый файл
      console.log(`📤 Создаем новый файл на Drive: ${fileName}`);
      const res = await drive.files.create({
        requestBody: {
          name: fileName,
          mimeType: "application/json",
          parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
        },
        media: {
          mimeType: "application/json",
          body: fileStream,
        },
      });
      console.log(
        `✓ Новый файл ${fileName} загружен на Drive. ID:`,
        res.data.id,
      );
      return { success: true, fileId: res.data.id };
    }
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
