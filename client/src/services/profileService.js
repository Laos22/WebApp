import axios from "axios";

/**
 * Сервисный слой для CRUD AI-профилей.
 * Инкапсулирует все сетевые детали (URL, credentials), чтобы UI и хуки
 * оставались чистыми и не знали о транспортном уровне.
 *
 * Бэкенд шифрует apiKey и отдаёт его расшифрованным только владельцу,
 * поэтому все запросы идут с withCredentials (сессионные куки).
 */
const SERVER_URL = import.meta.env.VITE_SERVER_URL;
const PROFILES_URL = `${SERVER_URL}/api/settings/profiles`;

// Общий инстанс: единая точка настройки заголовков/куки для профилей
const client = axios.create({
  baseURL: PROFILES_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

/**
 * Извлекает человекочитаемое сообщение об ошибке из ответа сервера.
 * @param {unknown} error
 * @param {string} fallback
 */
const toApiError = (error, fallback) => {
  const message = error?.response?.data?.error ?? error?.message ?? fallback;
  return new Error(message);
};

/** Получить список всех профилей текущего пользователя */
export async function fetchProfiles() {
  try {
    const { data } = await client.get("/");
    return data;
  } catch (error) {
    throw toApiError(error, "Не удалось загрузить профили");
  }
}

/** Создать новый профиль. Возвращает созданный профиль с id. */
export async function createProfile(profile) {
  try {
    const { data } = await client.post("/", profile);
    return data;
  } catch (error) {
    throw toApiError(error, "Не удалось создать профиль");
  }
}

/** Обновить существующий профиль по id. Возвращает обновлённый профиль. */
export async function updateProfile(id, profile) {
  try {
    const { data } = await client.put(`/${id}`, profile);
    return data;
  } catch (error) {
    throw toApiError(error, "Не удалось обновить профиль");
  }
}

/** Удалить профиль по id. */
export async function deleteProfile(id) {
  try {
    const { data } = await client.delete(`/${id}`);
    return data;
  } catch (error) {
    throw toApiError(error, "Не удалось удалить профиль");
  }
}
