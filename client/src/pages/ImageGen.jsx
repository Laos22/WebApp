import React, { useState } from "react";
import { Link } from "react-router-dom";
import { generateContent } from "../services/api";

export default function ImageGen() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("photorealistic");
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
        type: "image-description",
        style,
      });

      // Бэкенд возвращает result.content (текстовый ответ или описание от Gemini)
      const imageResult = {
        // Для изображений пока выводим сгенерированный текст/описание от AI
        // или демо-картинку, подкрепленную ответом нейросети
        imageUrl:
          "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop",
        prompt: prompt,
        style: style,
        description: response.result.content,
        timestamp: response.result.timestamp,
      };

      setResult(imageResult);
      setIsModalOpen(true);
    } catch (err) {
      setError(
        err.message ||
          "Произошла ошибка при генерации. Проверьте API-ключ в настройках.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Шапка страницы */}
        <div className="flex items-center justify-between">
          <div>
            <Link
              to="/"
              className="text-sm text-purple-400 hover:text-purple-300 transition-colors mb-2 inline-block"
            >
              &larr; На главную
            </Link>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">
              Генерация изображений 🎨
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Опишите вашу идею, и ИИ воплотит её в цифровое полотно.
            </p>
          </div>
        </div>

        {/* Форма */}
        <form
          onSubmit={handleSubmit}
          className="bg-slate-900/80 border border-purple-500/20 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-md space-y-6"
        >
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Промпт (описание изображения)
            </label>
            <textarea
              rows="4"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Например: Футуристический киберпанк город под дождем с неоновыми вывесками в стиле аниме..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all resize-none"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Стиль генерации
              </label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500 transition-all"
              >
                <option value="photorealistic">Фотореализм</option>
                <option value="anime">Аниме / Манга</option>
                <option value="cyberpunk">Киберпанк</option>
                <option value="digital-art">Цифровой арт</option>
                <option value="oil-painting">Масляная живопись</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-purple-600/25 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
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
                <span>Создаем шедевр...</span>
              </>
            ) : (
              <span>✨ Сгенерировать изображение</span>
            )}
          </button>
        </form>
      </div>

      {/* Модальное окно результата */}
      {isModalOpen && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-purple-500/30 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                <span>🎉 Результат генерации</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="rounded-xl overflow-hidden border border-slate-800 aspect-video relative group">
                <img
                  src={result.imageUrl}
                  alt={result.prompt}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800/80">
                <p className="text-xs text-purple-400 font-semibold uppercase tracking-wider">
                  Промпт:
                </p>
                <p className="text-slate-200 text-sm italic">
                  "{result.prompt}"
                </p>
                <div className="flex items-center justify-between pt-2 text-xs text-slate-400 border-t border-slate-800">
                  <span>
                    Стиль:{" "}
                    <strong className="text-slate-200">{result.style}</strong>
                  </span>
                  <span>Время: {result.timestamp}</span>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-950/50 flex justify-end space-x-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                Закрыть
              </button>
              <a
                href={result.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-purple-600/20"
              >
                Открыть в полном размере
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
