import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { syncToDrive } from "./driveSync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, "../../config/app-settings.json");

export const getSettings = () => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      // Если файла нет, возвращаем дефолтные настройки
      return {
        apiKey: "",
        systemPrompt:
          "Ты — профессиональный YouTube-сценарист. Твоя задача — создавать виральные сценарии.",
      };
    }
    const data = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(data);
  } catch (e) {
    console.error("Ошибка чтения конфига:", e);
    return {};
  }
};

export const updateSettings = (newSettings) => {
  try {
    const currentSettings = getSettings();
    const updated = { ...currentSettings, ...newSettings };

    // Убедимся, что папка config существует
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), "utf8");
    console.log("✓ Локальный конфиг сохранен:", CONFIG_PATH);

    // Запускаем синхронизацию асинхронно с дожиданием результата
    syncToDrive(CONFIG_PATH)
      .then((fileId) => {
        if (fileId) {
          console.log(
            "✅ Успешно синхронизировано с Google Drive. ID:",
            fileId,
          );
        } else {
          console.log("⚠️ Синхронизация завершена без ID");
        }
      })
      .catch((e) => {
        console.error("❌ Ошибка при вызове синхронизации с Drive:", e);
      });

    return updated;
  } catch (e) {
    console.error("Ошибка сохранения конфига:", e);
    throw e;
  }
};
