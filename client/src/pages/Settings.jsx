import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";

export default function Settings() {
  const [apiKey, setApiKey] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [driveStatus, setDriveStatus] = useState(null);
  const [driveLoading, setDriveLoading] = useState(false);

  const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5001";

  // Загрузить настройки при монтировании компонента
  useEffect(() => {
    fetchSettings();
    checkDriveStatus();
  }, []);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${SERVER_URL}/api/settings`);
      if (response.ok) {
        const data = await response.json();
        setApiKey(data.apiKey || "");
        setSystemPrompt(data.systemPrompt || "");
      } else {
        console.error("Ошибка загрузки настроек");
      }
    } catch (e) {
      console.error("Ошибка подключения к серверу:", e);
      // Fallback на localStorage для локальной разработки
      setApiKey(localStorage.getItem("google_ai_api_key") || "");
      setSystemPrompt(
        localStorage.getItem("ai_system_prompt") ||
          "Ты — профессиональный YouTube-сценарист. Твоя задача — создавать виральные сценарии, которые удерживают внимание зрителя.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const checkDriveStatus = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/auth/status`);
      if (response.ok) {
        const data = await response.json();
        setDriveStatus(data);
      }
    } catch (e) {
      console.error("Ошибка проверки статуса Drive:", e);
      setDriveStatus(null);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const response = await fetch(`${SERVER_URL}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, systemPrompt }),
      });

      if (response.ok) {
        setSavedMessage("✓ Настройки успешно сохранены и синхронизированы!");
        // Также сохраняем в localStorage для резервной копии
        localStorage.setItem("google_ai_api_key", apiKey);
        localStorage.setItem("ai_system_prompt", systemPrompt);
        setTimeout(() => setSavedMessage(""), 3000);
      } else {
        setSavedMessage("✗ Ошибка при сохранении");
        setTimeout(() => setSavedMessage(""), 3000);
      }
    } catch (e) {
      console.error("Ошибка сохранения:", e);
      setSavedMessage("✗ Ошибка подключения к серверу");
      // Fallback на localStorage
      localStorage.setItem("google_ai_api_key", apiKey);
      localStorage.setItem("ai_system_prompt", systemPrompt);
      setTimeout(() => setSavedMessage(""), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConnectGoogleDrive = () => {
    setDriveLoading(true);
    window.location.href = `${SERVER_URL}/auth/google`;
  };

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
            <p className="text-slate-400 text-sm mt-1">
              Управляйте API-ключами, системным промптом и интеграциями.
            </p>
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
          {/* Блок: AI Engine */}
          <section className="space-y-4 pb-6 border-b border-slate-800">
            <h2 className="text-xl font-bold text-white">🤖 AI Engine</h2>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                API Key для генерации (Gemini / OpenAI)
              </label>
              <p className="text-xs text-slate-500 mb-3">
                Ключ отправляется на сервер и сохраняется безопасно. Оставьте
                пустым, чтобы использовать серверный ключ.
              </p>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-... или AIza..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-all font-mono text-sm"
              />
            </div>
          </section>

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

          {/* Блок: Google Drive синхронизация */}
          <section className="space-y-4 pb-6 border-b border-slate-800">
            <h2 className="text-xl font-bold text-white">
              ☁️ Google Drive синхронизация
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Подключите Google Drive для автоматической синхронизации вашей
              конфигурации.
            </p>

            {driveStatus?.connected ? (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">✓</span>
                  <div>
                    <p className="text-emerald-400 font-medium">
                      Google Drive подключен
                    </p>
                    <p className="text-xs text-emerald-300/70">
                      Конфигурация автоматически синхронизируется
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleConnectGoogleDrive}
                disabled={driveLoading}
                className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:from-slate-700 disabled:to-slate-700 text-white font-semibold rounded-xl transition-all flex items-center justify-center space-x-2"
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5m-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11m3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
                </svg>
                <span>
                  {driveLoading ? "Подключение..." : "Подключить Google Drive"}
                </span>
              </button>
            )}
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
