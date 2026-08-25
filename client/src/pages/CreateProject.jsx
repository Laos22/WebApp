// client/src/pages/CreateProject.jsx
import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useGenerateTopic } from "../hooks/useGenerateTopic";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

export default function CreateProject() {
  const navigate = useNavigate();
  const { generateTopic, isLoading, error, topic, setTopic } = useGenerateTopic();
  const [systemPrompt, setSystemPrompt] = useState("");

  // Загружаем системный промпт при монтировании
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
    await generateTopic();
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
        {/* Информационный блок с системным промптом */}
        {systemPrompt && (
          <div className="p-4 bg-purple-900/20 border border-purple-500/30 rounded-xl text-sm text-slate-300">
            <p className="font-medium text-purple-300 mb-1">
              📌 Активный системный промпт:
            </p>
            <p className="line-clamp-2">{systemPrompt}</p>
          </div>
        )}

        {/* Кнопка генерации */}
        <button
          onClick={handleGenerateTopic}
          disabled={isLoading}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 text-white py-3 rounded-xl font-semibold transition-all"
        >
          {isLoading ? "Генерируем тему... ⏳" : "🎬 Генерировать тему видео"}
        </button>

        {/* Вывод ошибки */}
        {error && (
          <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl text-red-300 text-sm">
            ❌ {error}
          </div>
        )}

        {/* Результат */}
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