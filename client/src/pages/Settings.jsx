import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useProfiles } from "../hooks/useProfiles";
import ProfileCard from "../components/ProfileCard";
import ProfileFormModal from "../components/ProfileFormModal";
import { getEmptyProfile } from "../utils/aiProfileConstants";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;
console.log("🔗 SERVER_URL:", SERVER_URL);

// Настраиваем axios для передачи куки
axios.defaults.withCredentials = true;

export default function Settings() {
  const { user } = useAuth();
  const [prompts, setPrompts] = useState({
    theme: "1",
    script: "1",
    cover: "1",
    audio: "1",
    timelineDavinci: "1",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  // AI-профили: список и CRUD инкапсулированы в хуке.
  // Грузим только для авторизованного пользователя.
  const {
    profiles,
    isLoading: profilesLoading,
    error: profilesError,
    saveProfile,
    removeProfile,
  } = useProfiles(Boolean(user));

  // editingProfile === null -> модалка закрыта;
  // объект (в т.ч. пустой для нового) -> модалка открыта.
  const [editingProfile, setEditingProfile] = useState(null);

  // Загрузка глобальных настроек. useCallback -> стабильная ссылка
  // для зависимости useEffect (иначе react-hooks/immutability ругается).
  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await axios.get(`${SERVER_URL}/api/settings`);
      console.log("🔧 Loaded settings:", response.data);
      setPrompts(() => ({
        theme: response.data.prompts.theme || "",
        script: response.data.prompts.script || "",
        cover: response.data.prompts.cover || "",
        audio: response.data.prompts.audio || "",
        timelineDavinci: response.data.prompts.timelineDavinci || "",
      }));
    } catch (e) {
      console.error("Ошибка загрузки настроек:", e);
      setSavedMessage("✗ Ошибка загрузки настроек");
      setTimeout(() => setSavedMessage(""), 3000);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Загрузка данных с сервера при монтировании — легитимная
  // синхронизация с внешней системой (API), а не производное
  // состояние, поэтому синхронный setState внутри fetch допустим.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) fetchSettings();
  }, [user, fetchSettings]);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      console.log("💾 Saving settings:", prompts);
      const response = await axios.post(`${SERVER_URL}/api/settings`, {
        
        prompts: {
          theme: prompts.theme,
          script: prompts.script,
          cover: prompts.cover,
          audio: prompts.audio,
          timelineDavinci: prompts.timelineDavinci,
        },
      });

      if (response.status === 200) {
        setSavedMessage("✓ Настройки успешно сохранены!");
        setTimeout(() => setSavedMessage(""), 3000);
      }
    } catch (e) {
      console.error("Ошибка сохранения:", e);
      setSavedMessage("✗ Ошибка при сохранении");
      setTimeout(() => setSavedMessage(""), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Обработчики AI-профилей ---
  const handleSaveProfile = async (profile) => {
    try {
      await saveProfile(profile);
      setEditingProfile(null);
      setSavedMessage("✓ Профиль сохранён!");
    } catch (err) {
      setSavedMessage(`✗ ${err.message}`);
    } finally {
      setTimeout(() => setSavedMessage(""), 3000);
    }
  };

  const handleDeleteProfile = async (id) => {
    if (!window.confirm("Удалить этот профиль? Действие необратимо.")) return;
    try {
      await removeProfile(id);
      setSavedMessage("✓ Профиль удалён");
    } catch (err) {
      setSavedMessage(`✗ ${err.message}`);
    } finally {
      setTimeout(() => setSavedMessage(""), 3000);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6 md:p-12 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-400 mb-4">
            Требуется авторизация. Пожалуйста, залогинитесь.
          </p>
          <Link to="/" className="text-purple-400 hover:text-purple-300">
            Вернуться на главную
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6 md:p-12 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-slate-400">Загрузка настроек...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Заголовок */}
        <div className="flex items-center justify-between">
          <div>
            <Link
              to="/"
              className="text-sm text-purple-400 hover:text-purple-300 transition-colors mb-2 inline-block"
            >
              &larr; На главную
            </Link>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">
              Настройки ⚙️
            </h1>
          </div>
        </div>

        {/* Сообщение об успехе */}
        {savedMessage && (
          <div
            className={`p-4 border rounded-xl text-sm ${
              savedMessage.includes("✓")
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}
          >
            {savedMessage}
          </div>
        )}

        <form
          onSubmit={handleSaveSettings}
          className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl space-y-8"
        >
          {/* Блок: Системный промпт для темы*/}
          <section className="space-y-4 pb-6 border-b border-slate-800">
            <h2 className="text-xl font-bold text-white">
              📝 Системный промпт для темы
            </h2>
            <p className="text-xs text-slate-400">
              Глобальная "личность" для ИИ. Она будет использоваться при всех
              генерациях тем и контента.
            </p>
            <textarea
              value={prompts.theme}
              onChange={(e) => setPrompts((prev) => ({ ...prev, theme: e.target.value }))}
              className="w-full h-40 bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm text-white focus:border-purple-500 transition-all outline-none resize-none"
              placeholder="Например: Ты — опытный сценарист YouTube Shorts в нише технологий..."
            />
            <p className="text-xs text-slate-500">
              💡 Совет: Опишите роль, стиль, целевую аудиторию и любые
              ограничения, которые должен учитывать ИИ.
            </p>
          </section>
          {/* Блок: Системный промпт для сценария */}
          <section className="space-y-4 pb-6 border-b border-slate-800">
            <h2 className="text-xl font-bold text-white">
              📝 Системный промпт для сценария
            </h2>
            <p className="text-xs text-slate-400">
              Глобальная "личность" для ИИ. Она будет использоваться при всех
              генерациях тем и контента.
            </p>
            <textarea
              value={prompts.script}
              onChange={(e) => setPrompts((prev) => ({ ...prev, script: e.target.value }))}
              className="w-full h-40 bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm text-white focus:border-purple-500 transition-all outline-none resize-none"
              placeholder="Например: Ты — опытный сценарист YouTube Shorts в нише технологий..."
            />
            <p className="text-xs text-slate-500">
              💡 Совет: Опишите роль, стиль, целевую аудиторию и любые
              ограничения, которые должен учитывать ИИ.
            </p>
          </section>

          {/* Кнопка сохранения */}
          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-slate-700 disabled:to-slate-700 text-white font-semibold rounded-xl shadow-lg transition-all"
          >
            {isSaving ? "Сохранение..." : "Сохранить все настройки"}
          </button>
        </form>

        {/* Блок: AI-профили */}
        <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white">🤖 AI-профили</h2>
              <p className="text-xs text-slate-400 mt-1">
                Наборы провайдеров и ключей для генерации текста, изображений и
                звука. Ключи шифруются на сервере.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditingProfile(getEmptyProfile())}
              className="inline-flex items-center gap-2 shrink-0 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-semibold rounded-xl shadow-lg transition-all"
            >
              <Plus size={18} />
              Добавить
            </button>
          </div>

          {profilesError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
              {profilesError}
            </div>
          )}

          {profilesLoading ? (
            <p className="text-sm text-slate-400 py-4">Загрузка профилей...</p>
          ) : profiles.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              Пока нет ни одного профиля. Создайте первый, нажав «Добавить».
            </p>
          ) : (
            <div className="space-y-3">
              {profiles.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  onEdit={setEditingProfile}
                  onDelete={handleDeleteProfile}
                />
              ))}
            </div>
          )}
        </section>

        {/* Дополнительная информация */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-3">
          <h3 className="font-semibold text-slate-300">ℹ️ Как это работает</h3>
          <ul className="text-sm text-slate-400 space-y-2">
            <li>
              • <strong>Системный промпт</strong> определяет "личность" ИИ для
              всех генераций.
            </li>
            <li>
              • <strong>API-ключи AI-профилей</strong> шифруются и хранятся на
              сервере, не передаются в браузер в открытом виде.
            </li>
            <li>
              • Настройки загружаются с сервера при каждом сеансе для
              консистентности.
            </li>
          </ul>
        </div>
      </div>

      {/* Модалка создания / редактирования профиля.
          key заставляет форму пересоздаваться под конкретный профиль
          (требование ProfileFormModal). */}
      {editingProfile && (
        <ProfileFormModal
          key={editingProfile.id ?? "new"}
          initialProfile={editingProfile}
          onSave={handleSaveProfile}
          onClose={() => setEditingProfile(null)}
        />
      )}
    </div>
  );
}
