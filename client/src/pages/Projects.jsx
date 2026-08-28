import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import axios from "axios";

const API_URL = import.meta.env.VITE_SERVER_URL;

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState("grid"); // 'grid' или 'list'

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/projects`, {
        withCredentials: true,
      });
      if (response.data.success) {
        setProjects(response.data.projects);
      }
    } catch (err) {
      console.error("Ошибка при загрузке проектов:", err);
      setError("Не удалось загрузить проекты. Попробуйте обновить страницу.");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">
              Мои проекты 📂
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Выберите проект для работы или создайте новый рабочий
              пространственный контекст.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Переключатель вида */}
            {!loading && !error && projects.length > 0 && (
              <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 shadow-inner">
                <button
                  onClick={() => setViewMode("grid")}
                  title="Карточки"
                  className={`p-2 rounded-lg transition-all ${
                    viewMode === "grid"
                      ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  title="Компактный список"
                  className={`p-2 rounded-lg transition-all ${
                    viewMode === "list"
                      ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                </button>
              </div>
            )}
            <Link
              to="/projects/new"
              className="px-5 py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl shadow-lg shadow-purple-600/25 transition-all"
            >
              + Новый проект
            </Link>
          </div>
        </div>

        {/* Индикатор загрузки */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin"></div>
            <p className="text-slate-400 animate-pulse">
              Загрузка ваших проектов...
            </p>
          </div>
        )}

        {/* Ошибка */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-center">
            {error}
          </div>
        )}

        {/* Пустое состояние */}
        {!loading && !error && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl space-y-4">
            <div className="text-5xl opacity-50">🌑</div>
            <h3 className="text-xl font-medium text-slate-300">
              У вас пока нет проектов
            </h3>
            <p className="text-slate-500 max-w-sm text-center">
              Создайте свой первый проект, чтобы начать генерировать контент и
              управлять AI-процессами.
            </p>
            <Link
              to="/projects/new"
              className="mt-2 text-purple-400 hover:text-purple-300 font-semibold"
            >
              Создать проект &rarr;
            </Link>
          </div>
        )}

        {/* Список проектов */}
        {!loading && projects.length > 0 && viewMode === "grid" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((proj) => (
              <Link
                key={proj._id}
                to={`/projects/${proj._id}`}
                className="group p-6 bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-purple-500/50 rounded-2xl transition-all duration-300 shadow-xl flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-xl mb-3 group-hover:scale-110 transition-transform">
                    📁
                  </div>
                  <h3 className="text-xl font-bold text-white group-hover:text-purple-300 transition-colors line-clamp-2">
                    {proj.shortTitle}
                  </h3>
                  <p className="text-slate-400 text-sm mt-1 line-clamp-3">
                    {proj.videoTopicDescription ||
                      proj.description ||
                      "Без описания"}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-slate-800/80 text-xs text-slate-500">
                  <span>Обновлено: {formatDate(proj.updatedAt)}</span>
                  <span className="text-purple-400 font-semibold group-hover:translate-x-1 transition-transform">
                    Открыть &rarr;
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Компактный список проектов */}
        {!loading && projects.length > 0 && viewMode === "list" && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl shadow-xl overflow-hidden divide-y divide-slate-800/80">
            {projects.map((proj) => (
              <Link
                key={proj._id}
                to={`/projects/${proj._id}`}
                className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:px-6 hover:bg-slate-900 transition-colors gap-4"
              >
                <div className="flex items-center space-x-4 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex-shrink-0 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
                    📁
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-white group-hover:text-purple-300 transition-colors truncate">
                      {proj.shortTitle}
                    </h3>
                    {/* <p className="text-slate-400 text-xs truncate mt-0.5 max-w-xl">
                      {proj.videoTopicDescription ||
                        proj.description ||
                        "Без описания"}
                    </p> */}
                  </div>
                </div>
                <div className="flex items-center justify-between sm:justify-end sm:space-x-6 text-xs text-slate-500 flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-slate-800/60">
                  <span>Обновлено: {formatDate(proj.updatedAt)}</span>
                  <span className="text-purple-400 font-semibold group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                    Открыть &rarr;
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
