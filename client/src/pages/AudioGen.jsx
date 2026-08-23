import React, { useState } from "react";
import { Link } from "react-router-dom";
import { generateContent } from "../services/api";

export default function AudioGen() {
  const [prompt, setPrompt] = useState("");
  const [contentType, setContentType] = useState("podcast-script");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // 🚀 Отправляем реальный запрос на бэкенд через api.js
      const response = await generateContent({
        prompt,
        type: contentType,
      });

      const audioResult = {
        title: "Сгенерированный AI-контент",
        content: response.result.content,
        type: contentType,
        timestamp: response.result.timestamp,
      };

      setResult(audioResult);
      setIsModalOpen(true);
    } catch (err) {
      setError(
        err.message ||
          "Не удалось сгенерировать контент. Проверьте API-ключ в настройках.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Шапка */}
        <div className="flex items-center justify-between">
          <div>
            <Link
              to="/"
              className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors mb-2 inline-block"
            >
              &larr; На главную
            </Link>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-indigo-300 bg-clip-text text-transparent">
              Генерация Audio / AI 🎙️
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Создавайте аудиосценарии, подкасты и интеллектуальный контент с
              помощью ИИ.
            </p>
          </div>
        </div>

        {/* Форма */}
        <form
          onSubmit={handleSubmit}
          className="bg-slate-900/80 border border-indigo-500/20 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-md space-y-6"
        >
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Тема или описание для генерации
            </label>
            <textarea
              rows="4"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Например: Подготовь сценарий для подкаста про будущее искусственного интеллекта в медицине..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Тип контента
            </label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 transition-all"
            >
              <option value="podcast-script">Сценарий подкаста</option>
              <option value="voiceover-text">
                Текст для озвучки (Voiceover)
              </option>
              <option value="audio-ideas">Идеи для аудио-шоу</option>
              <option value="summary">Краткая выжимка (Summary)</option>
            </select>
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold rounded-xl shadow-lg shadow-indigo-600/25 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <span>Генерируем аудио-контент...</span>
              </>
            ) : (
              <span>🎙️ Сгенерировать контент</span>
            )}
          </button>
        </form>
      </div>

      {/* Модальное окно результата */}
      {isModalOpen && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                <span>🎧 Результат генерации</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 max-h-60 overflow-y-auto">
                <pre className="text-slate-200 text-sm whitespace-pre-wrap font-sans">
                  {result.content}
                </pre>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-950/50 p-3 rounded-xl border border-slate-800">
                <span>
                  Тип: <strong className="text-slate-200">{result.type}</strong>
                </span>
                <span>Время: {result.timestamp}</span>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-950/50 flex justify-end space-x-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                Закрыть
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(result.content);
                  alert("Текст скопирован в буфер обмена!");
                }}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-indigo-600/20"
              >
                Копировать текст
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
