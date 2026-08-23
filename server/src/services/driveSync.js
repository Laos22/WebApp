import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRIVE_AUTH_PATH = path.join(__dirname, '../../config/drive-auth.json');

/**
 * Получить сохраненные токены из локального файла
 */
export const getStoredTokens = () => {
    try {
        if (!fs.existsSync(DRIVE_AUTH_PATH)) {
            return null;
        }
        const data = fs.readFileSync(DRIVE_AUTH_PATH, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Ошибка чтения токенов:", e);
        return null;
    }
};

/**
 * Сохранить токены локально
 */
export const saveTokens = (tokens) => {
    try {
        const dir = path.dirname(DRIVE_AUTH_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(DRIVE_AUTH_PATH, JSON.stringify(tokens, null, 2), 'utf8');
    } catch (e) {
        console.error("Ошибка сохранения токенов:", e);
        throw e;
    }
};

/**
 * Инициализировать Google Drive клиент с refresh token
 */
export const initDriveClient = (oauth2Client) => {
    return google.drive({ version: 'v3', auth: oauth2Client });
};

/**
 * Синхронизировать файл на Google Drive
 * @param {string} filePath - путь к локальному файлу
 * @param {string} fileId - ID файла на Drive (если уже создан)
 */
export const syncToDrive = async (filePath, fileId = null) => {
    try {
        const tokens = getStoredTokens();
        
        if (!tokens) {
            console.log("Токены не найдены. Синхронизация пропущена.");
            return null;
        }

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            `${process.env.SERVER_URL}/auth/callback`
        );

        oauth2Client.setCredentials(tokens);

        // Проверяем, не протух ли access_token
        if (tokens.expiry_date && new Date(tokens.expiry_date) < new Date()) {
            const { credentials } = await oauth2Client.refreshAccessToken();
            saveTokens(credentials);
            oauth2Client.setCredentials(credentials);
        }

        const drive = initDriveClient(oauth2Client);
        const fileName = path.basename(filePath);
        const fileContent = fs.readFileSync(filePath);

        if (fileId) {
            // Обновляем существующий файл
            await drive.files.update({
                fileId,
                media: {
                    mimeType: 'application/json',
                    body: fileContent
                }
            });
            console.log(`✓ Файл ${fileName} обновлен на Drive`);
        } else {
            // Создаем новый файл
            const res = await drive.files.create({
                requestBody: {
                    name: fileName,
                    mimeType: 'application/json',
                    parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
                },
                media: {
                    mimeType: 'application/json',
                    body: fileContent
                }
            });
            console.log(`✓ Новый файл ${fileName} загружен на Drive:`, res.data.id);
            return res.data.id;
        }
    } catch (e) {
        console.error("Ошибка синхронизации с Drive:", e);
        // Не бросаем исключение, чтобы приложение продолжало работать
    }
};

/**
 * Скачать файл с Google Drive
 */
export const downloadFromDrive = async (fileId, destPath) => {
    try {
        const tokens = getStoredTokens();
        
        if (!tokens) {
            console.log("Токены не найдены. Загрузка пропущена.");
            return false;
        }

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            `${process.env.SERVER_URL}/auth/callback`
        );

        oauth2Client.setCredentials(tokens);

        const drive = initDriveClient(oauth2Client);
        const res = await drive.files.get(
            { fileId, alt: 'media' },
            { responseType: 'stream' }
        );

        return new Promise((resolve, reject) => {
            res.data
                .pipe(fs.createWriteStream(destPath))
                .on('finish', () => {
                    console.log(`✓ Файл загружен с Drive: ${destPath}`);
                    resolve(true);
                })
                .on('error', reject);
        });
    } catch (e) {
        console.error("Ошибка загрузки с Drive:", e);
        return false;
    }
};
