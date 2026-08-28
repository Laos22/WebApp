import crypto from "crypto";

/**
 * Сервис симметричного шифрования секретов (AES-256-GCM).
 *
 * Схема хранения одного значения (base64):
 *   [ salt(16) | iv(16) | authTag(16) | ciphertext ]
 *
 * Ключ шифрования выводится из ENCRYPTION_KEY через PBKDF2 (100k итераций,
 * SHA-512) с рандомной солью на КАЖДОЕ шифрование — одинаковый plaintext
 * даёт разный ciphertext, что затрудняет анализ.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 бит

/**
 * Мастер-ключ берётся строго из окружения. Никаких дефолтов:
 * молчаливая заглушка означала бы, что в проде секреты "зашифрованы"
 * общеизвестным ключом, т.е. фактически лежат открыто.
 */
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  throw new Error(
    "ENCRYPTION_KEY не задан или короче 32 символов. " +
      "Сгенерируйте ключ (`openssl rand -base64 48`) и добавьте в server/.env — " +
      "без него шифрование секретов небезопасно.",
  );
}

/**
 * Выводит 32-байтный ключ из мастер-ключа и соли.
 * @param {Buffer} salt
 * @returns {Buffer}
 */
const deriveKey = (salt) =>
  crypto.pbkdf2Sync(
    ENCRYPTION_KEY,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    "sha512",
  );

/**
 * Шифрует строку. Пустое/отсутствующее значение возвращается как null.
 * @param {string|null|undefined} text
 * @returns {string|null} base64-строка или null
 */
export const encryptData = (text) => {
  if (!text) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, encrypted]).toString("base64");
};

/**
 * Расшифровывает строку, полученную из encryptData.
 *
 * Устойчива к «мусору»: если значение битое, не в том формате или
 * зашифровано другим ключом — возвращает null вместо выброса исключения.
 * Это защищает эндпоинты (например, GET /profiles) от падения в 500
 * из-за одного повреждённого/legacy-значения.
 *
 * @param {string|null|undefined} encryptedText
 * @returns {string|null}
 */
export const decryptData = (encryptedText) => {
  if (!encryptedText) return null;

  try {
    const data = Buffer.from(encryptedText, "base64");

    // Минимальная длина: соль + iv + tag (+ хотя бы 1 байт данных)
    if (data.length <= SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
      return null;
    }

    const salt = data.subarray(0, SALT_LENGTH);
    const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = data.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
    );
    const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    const key = deriveKey(salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    console.error("⚠️  Не удалось расшифровать значение:", error.message);
    return null;
  }
};

/**
 * Маскирует секрет для безопасной отдачи на фронтенд.
 * Показываем только последние 4 символа: "••••••••••1a2b".
 * Полный ключ НИКОГДА не покидает бэкенд.
 *
 * @param {string|null|undefined} secret - уже расшифрованный ключ
 * @returns {string} маска или "" если ключа нет
 */
export const maskSecret = (secret) => {
  if (!secret) return "";
  const tail = secret.slice(-4);
  return `${"•".repeat(8)}${tail}`;
};
