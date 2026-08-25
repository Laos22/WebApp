import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;
console.log("🔗 SERVER_URL:", SERVER_URL);

// Настраиваем axios для передачи куки
axios.defaults.withCredentials = true;

export default function Settings() {
  const { user, logout } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [driveStatus, setDriveStatus] = useState(null);
  const [driveLoading, setDriveLoading] = useState(false);

  // Загрузить настройки при монтировании компонента
  useEffect(() => {
    if (user) {
      fetchSettings();
    }
  }, [user]);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const response = await axios.get(`${SERVER_URL}/api/settings`);
      setApiKey(response.data.apiKey || "");
      setSystemPrompt(
        response.data.systemPrompt ||
          "Ты — профессиональный YouTube-сценарист.",
      );
      setDriveStatus({
        connected: response.data.driveConnected || false,
        hasRefreshToken: !!response.data.driveFileId,
      });
    } catch (e) {
      console.error("Ошибка загрузки настроек:", e);
      setSavedMessage("✗ Ошибка загрузки настроек");
      setTimeout(() => setSavedMessage(""), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const response = await axios.post(`${SERVER_URL}/api/settings`, {
        apiKey,
        systemPrompt,
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
          

          {/* Блок: Системный промпт */}
          <section className="space-y-4 pb-6 border-b border-slate-800">
            <h2 className="text-xl font-bold text-white">
              📝 Системный промпт
            </h2>
            <p className="text-xs text-slate-400">
              Глобальная "личность" для ИИ. Она будет использоваться при всех
              генерациях тем и контента.
            </p>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
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

        {/* Дополнительная информация */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-3">
          <h3 className="font-semibold text-slate-300">ℹ️ Как это работает</h3>
          <ul className="text-sm text-slate-400 space-y-2">
            <li>
              • <strong>Системный промпт</strong> определяет "личность" ИИ для
              всех генераций.
            </li>
            <li>
              • <strong>API Key</strong> шифруется и хранится на сервере, не
              передается в браузер.
            </li>
            <li>
              • При подключении <strong>Google Drive</strong>, все изменения
              автоматически синхронизируются в облако.
            </li>
            <li>
              • Настройки загружаются с сервера при каждом сеансе для
              консистентности.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
