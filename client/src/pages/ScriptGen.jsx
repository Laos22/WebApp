import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";

const API_URL = import.meta.env.VITE_SERVER_URL;

export default function ScriptGen() {
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
      // 🚀 Отправляем запрос на генерацию сценария
      const response = await axios.post(
        `${API_URL}/api/projects/${projectId}/generate-script`,
        {
          prompt,
          projectDescription: project?.description,
        },
        { withCredentials: true }
      );

      const scriptResult = {
        title: "Сгенерированный сценарий",
        content: response.data.script,
        timestamp: new Date().toISOString(),
      };

      setResult(scriptResult);
      setIsModalOpen(true);
      setPrompt("");
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.message ||
          "Не удалось сгенерировать сценарий. Проверьте настройки."
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
              className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors mb-2 inline-block"
            >
              &larr; Назад к проекту
            </Link>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-emerald-300 bg-clip-text text-transparent">
              Генерация сценария 📝
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Интеллектуальная генерация сценария для видео проекта "{project.shortTitle}".
            </p>
          </div>
        </div>

        {/* Форма */}
        <form
          onSubmit={handleSubmit}
          className="bg-slate-900/80 border border-emerald-500/20 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-md space-y-6"
        >
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Описание или тема для сценария
            </label>
            <textarea
              rows="5"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Например: Создай сценарий для 10-минутного видео о путешествии в Японию, включая интересные факты о культуре и достопримечательностях..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all resize-none"
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
            className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-600/25 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
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
                <span>Генерируем сценарий...</span>
              </>
            ) : (
              <span>📝 Сгенерировать сценарий</span>
            )}
          </button>
        </form>

        {/* Инфо блок */}
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 text-slate-300 text-sm space-y-2">
          <p className="font-semibold text-emerald-300">💡 Совет:</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Опишите тему и основную идею видео</li>
            <li>Укажите целевую аудиторию и длительность видео</li>
            <li>Добавьте специфические детали или требования к стилю</li>
          </ul>
        </div>
      </div>

      {/* Модальное окно результата */}
      {isModalOpen && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                <span>📝 Ваш сценарий</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 max-h-96 overflow-y-auto">
                <pre className="text-slate-200 text-sm whitespace-pre-wrap font-sans">
                  {result.content}
                </pre>
              </div>

              <div className="text-xs text-slate-400 bg-slate-950/50 p-3 rounded-xl border border-slate-800">
                <span>Создано: {new Date(result.timestamp).toLocaleString("ru-RU")}</span>
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
                  alert("Сценарий скопирован в буфер обмена!");
                }}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-emerald-600/20"
              >
                Копировать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
