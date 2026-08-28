import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";

const API_URL = import.meta.env.VITE_SERVER_URL;

export default function CoverGen() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchProject();
  }, [projectId]);

  const fetchProject = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/projects/${projectId}`, {
        withCredentials: true,
      });
      setProject(response.data.project);
    } catch (err) {
      console.error("Ошибка при загрузке проекта:", err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // 🚀 Отправляем запрос на генерацию обложки
      const response = await axios.post(
        `${API_URL}/api/projects/${projectId}/generate-cover`,
        {
          prompt,
          projectTitle: project?.title,
          projectDescription: project?.description,
        },
        { withCredentials: true },
      );

      const coverResult = {
        title: "Сгенерированные данные обложки",
        titleText: response.data.coverData.title,
        visualDescription: response.data.coverData.visual_description,
        colorPalette: response.data.coverData.color_palette || [],
        keyElements: response.data.coverData.key_elements || [],
        mainEmotion: response.data.coverData.main_emotion,
        timestamp: new Date().toISOString(),
      };

      setResult(coverResult);
      setIsModalOpen(true);
      setPrompt("");
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.message ||
          "Не удалось сгенерировать обложку. Проверьте настройки.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (!project) {
    return <div className="text-white p-12">Загрузка проекта...</div>;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Шапка */}
        <div className="flex items-center justify-between">
          <div>
            <Link
              to={`/projects/${projectId}`}
              className="text-sm text-yellow-400 hover:text-yellow-300 transition-colors mb-2 inline-block"
            >
              &larr; Назад к проекту
            </Link>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-yellow-300 bg-clip-text text-transparent">
              Генерация обложки 🖼️
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Создавайте название и изображение обложки для видео "
              {project.shortTitle}".
            </p>
          </div>
        </div>

        {/* Форма */}
        <form
          onSubmit={handleSubmit}
          className="bg-slate-900/80 border border-yellow-500/20 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-md space-y-6"
        >
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Описание для генерации обложки
            </label>
            <textarea
              rows="5"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Например: Создай яркую обложку для видео о путешествии в Японию. Включи традиционные элементы японской культуры, горы, храмы и закат. Стиль: современный минимализм с яркими цветами."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 transition-all resize-none"
              required
            />
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-white font-semibold rounded-xl shadow-lg shadow-yellow-600/25 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
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
                <span>Генерируем обложку...</span>
              </>
            ) : (
              <span>🖼️ Сгенерировать обложку</span>
            )}
          </button>
        </form>

        {/* Инфо блок */}
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 text-slate-300 text-sm space-y-2">
          <p className="font-semibold text-yellow-300">💡 Совет:</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Опишите желаемый стиль и цветовую схему</li>
            <li>Укажите ключевые элементы, которые должны быть на обложке</li>
            <li>Упомяните тему и целевую аудиторию видео</li>
          </ul>
        </div>
      </div>

      {/* Модальное окно результата */}
      {isModalOpen && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-yellow-500/30 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                <span>🖼️ Ваша обложка</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
              {/* Название обложки */}
              <div>
                <label className="text-sm font-semibold text-yellow-300 mb-2 block">
                  Название обложки:
                </label>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <p className="text-slate-200 text-lg font-bold">
                    {result.titleText}
                  </p>
                </div>
              </div>

              {/* Визуальное описание */}
              {result.visualDescription && (
                <div>
                  <label className="text-sm font-semibold text-yellow-300 mb-2 block">
                    Визуальное описание:
                  </label>
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 max-h-32 overflow-y-auto">
                    <p className="text-slate-300 text-sm whitespace-pre-wrap">
                      {result.visualDescription}
                    </p>
                  </div>
                </div>
              )}

              {/* Цветовая палитра */}
              {result.colorPalette && Array.isArray(result.colorPalette) && (
                <div>
                  <label className="text-sm font-semibold text-yellow-300 mb-2 block">
                    Цветовая палитра:
                  </label>
                  <div className="flex gap-3">
                    {result.colorPalette.map((color, idx) => (
                      <div
                        key={idx}
                        className="flex-1 flex flex-col items-center gap-2"
                      >
                        <div
                          className="w-full h-20 rounded-lg border-2 border-slate-700 shadow-lg"
                          style={{ backgroundColor: color }}
                        />
                        <code className="text-xs text-slate-400 font-mono">
                          {color}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ключевые элементы */}
              {result.keyElements && Array.isArray(result.keyElements) && (
                <div>
                  <label className="text-sm font-semibold text-yellow-300 mb-2 block">
                    Ключевые элементы:
                  </label>
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div className="flex flex-wrap gap-2">
                      {result.keyElements.map((element, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1.5 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-full text-sm"
                        >
                          {element}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Главное эмоциональное воздействие */}
              {result.mainEmotion && (
                <div>
                  <label className="text-sm font-semibold text-yellow-300 mb-2 block">
                    Главное эмоциональное воздействие:
                  </label>
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <p className="text-slate-200 text-lg font-semibold capitalize">
                      {result.mainEmotion}
                    </p>
                  </div>
                </div>
              )}

              <div className="text-xs text-slate-400 bg-slate-950/50 p-3 rounded-xl border border-slate-800">
                <span>
                  Создано: {new Date(result.timestamp).toLocaleString("ru-RU")}
                </span>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-950/50 flex justify-end space-x-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
