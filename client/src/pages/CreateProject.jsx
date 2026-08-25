// client/src/pages/CreateProject.jsx
// ... existing imports ...
import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useGenerateTopic } from "../hooks/useGenerateTopic";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

export default function CreateProject() {
  const navigate = useNavigate();
  const { generateTopic, isLoading, error, topic, setTopic } = useGenerateTopic();
  const [systemPrompt, setSystemPrompt] = useState("");
  const [keywords, setKeywords] = useState(""); // 👈 Стейт для ключевых слов

  useEffect(() => {
    fetchSystemPrompt();
  }, []);

  const fetchSystemPrompt = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/settings/prompt`, {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setSystemPrompt(data.systemPrompt);
      }
    } catch (err) {
      console.error("Ошибка загрузки системного промпта:", err);
    }
  };

  const handleGenerateTopic = async () => {
    await generateTopic(keywords); // 👈 Передаем ключевые слова в хук
  };

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-white">Новый проект</h1>
        <Link
          to="/settings"
          className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
        >
          ⚙️ Системный промпт
        </Link>
      </div>

      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl space-y-6">
        {systemPrompt && (
          <div className="p-4 bg-purple-900/20 border border-purple-500/30 rounded-xl text-sm text-slate-300">
            <p className="font-medium text-purple-300 mb-1">
              📌 Активный системный промпт:
            </p>
            <p className="line-clamp-2">{systemPrompt}</p>
          </div>
        )}

        {/* 👈 Блок ввода ключевых слов */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-slate-300">
              🔑 Ключевые слова или контекст:
            </label>
            {/* Заглушка под будущую интеграцию с YouTube API */}
            <button
              type="button"
              disabled
              className="text-xs text-slate-500 hover:text-slate-400 cursor-not-allowed"
              title="Скоро: Авто-генерация ключевых слов через YouTube API"
            >
              ✨ Сгенерировать из YouTube (скоро)
            </button>
          </div>
          <textarea
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="Например: Искусственный интеллект, тренды 2025, лайфхаки для разработчиков..."
            rows={3}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors resize-none"
          />
        </div>

        <button
          onClick={handleGenerateTopic}
          disabled={isLoading}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 text-white py-3 rounded-xl font-semibold transition-all shadow-lg shadow-purple-600/20"
        >
          {isLoading ? "Генерируем тему... ⏳" : "🎬 Генерировать тему видео"}
        </button>

        {error && (
          <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl text-red-300 text-sm">
            ❌ {error}
          </div>
        )}

        {topic && (
          <div className="p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-xl text-sm text-slate-200 whitespace-pre-wrap">
            <p className="font-medium text-emerald-300 mb-2">✅ Сгенерированная тема:</p>
            <p>{topic}</p>
          </div>
        )}
      </div>
    </div>
  );
}