import { useCallback, useEffect, useState } from "react";
import {
  fetchProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
} from "../services/profileService";

/**
 * Хук управления AI-профилями.
 * Держит весь стейт (список, флаги загрузки, ошибки) и предоставляет
 * CRUD-операции. Компоненты благодаря этому остаются презентационными.
 *
 * @param {boolean} enabled — грузить ли профили сразу (напр. только для авторизованных)
 */
export function useProfiles(enabled = true) {
  const [profiles, setProfiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Первичная загрузка списка
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchProfiles();
      setProfiles(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  /**
   * Сохранить профиль (создание или обновление в зависимости от наличия id).
   * После успеха синхронизируем локальный список с ответом сервера
   * (там актуальные id и снятые флаги isDefault у соседей).
   */
  const saveProfile = useCallback(
    async (profile) => {
      const isUpdate = Boolean(profile.id);
      const saved = isUpdate
        ? await updateProfile(profile.id, profile)
        : await createProfile(profile);

      // Сервер мог снять isDefault у других профилей того же типа,
      // поэтому надёжнее перечитать весь список, чем мержить локально.
      await refresh();
      return saved;
    },
    [refresh],
  );

  /** Удалить профиль с оптимистичным обновлением UI. */
  const removeProfile = useCallback(
    async (id) => {
      const snapshot = profiles;
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      try {
        await deleteProfile(id);
      } catch (err) {
        // Откатываем при ошибке, чтобы UI не расходился с сервером
        setProfiles(snapshot);
        throw err;
      }
    },
    [profiles],
  );

  return {
    profiles,
    isLoading,
    error,
    refresh,
    saveProfile,
    removeProfile,
  };
}
