// server/src/services/aiProfileResolver.js

import { decryptData } from "./encryptionService.js";

/**
 * Утилита выбора AI-профиля из настроек пользователя.
 *
 * Зачем это нужно:
 * Раньше генерация всегда использовала ключ из .env и жёстко заданную модель,
 * полностью игнорируя профили, настроенные пользователем в UI.
 * Здесь мы централизуем логику выбора нужного профиля и делаем её прозрачной
 * через логирование — чтобы в консоли сервера было видно, какой профиль
 * (провайдер + модель) реально применяется при каждом запросе.
 */

/**
 * Находит дефолтный профиль указанного типа в настройках.
 * Если профиль с флагом isDefault отсутствует — берём первый профиль этого типа.
 *
 * @param {Object|null} settings - Документ настроек пользователя (может быть null)
 * @param {"text"|"image"|"audio"} type - Тип профиля
 * @returns {Object|null} Найденный профиль или null
 */
export function resolveProfile(settings, type) {
  const profiles = settings?.profiles ?? [];
  const ofType = profiles.filter((p) => p.type === type);

  if (ofType.length === 0) return null;

  // Приоритет — профиль, помеченный как дефолтный
  return ofType.find((p) => p.isDefault) ?? ofType[0];
}

/**
 * Расшифровывает apiKey профиля для фактического исходящего вызова к внешнему API.
 *
 * Это ЕДИНСТВЕННОЕ место, где ключ возвращается в открытом виде на бэкенде.
 * Профиль хранит apiKey в зашифрованном виде; сюда передаём именно его.
 * Если ключа нет или он повреждён — возвращаем null, и вызывающий код
 * решает, использовать ли fallback из .env.
 *
 * @param {Object|null} profile - Выбранный профиль
 * @returns {string|null} Расшифрованный ключ или null
 */
export function getDecryptedApiKey(profile) {
  if (!profile?.apiKey) return null;
  return decryptData(profile.apiKey);
}

/**
 * Логирует, какой профиль был выбран для операции генерации.
 * Ключи API НИКОГДА не выводятся целиком — только признак наличия.
 *
 * @param {string} operation - Название операции (например, "generate-topic")
 * @param {Object|null} profile - Выбранный профиль
 * @param {"text"|"image"|"audio"} type - Тип профиля
 */
export function logProfileUsage(operation, profile, type) {
  if (!profile) {
    console.warn(
      `⚙️  [${operation}] Профиль типа "${type}" не найден. ` +
        `Использую fallback из .env (GEMINI_API_KEY).`,
    );
    return;
  }

  const model =
    profile.textSettings?.primaryModel ??
    profile.imageSettings?.model ??
    profile.audioSettings?.voiceId ??
    "(модель не задана)";

  console.log(
    `⚙️  [${operation}] Профиль: "${profile.name}" | ` +
      `provider=${profile.provider} | model=${model} | ` +
      `apiKey=${profile.apiKey ? "задан ✅" : "отсутствует ❌"}`,
  );
}
