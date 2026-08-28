import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import axios from "axios";

const API_URL = import.meta.env.VITE_SERVER_URL;

export default function ProjectWorkspace() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

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
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        "Вы уверены, что хотите удалить этот проект? Это действие нельзя отменить (удалятся все файлы на диске).",
      )
    )
      return;
    try {
      await axios.delete(`${API_URL}/api/projects/${projectId}`, {
        withCredentials: true,
      });
      navigate("/");
    } catch (err) {
      console.error("Ошибка при удалении проекта:", err);
      alert("Не удалось удалить проект.");
    }
  };

  if (loading) return <div className="text-white p-12">Загрузка...</div>;
  if (!project) return <div className="text-white p-12">Проект не найден.</div>;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <Link
            to="/"
            className="text-sm text-purple-400 hover:text-purple-300 transition-colors mb-2 inline-block"
          >
            &larr; Назад к списку проектов
          </Link>
          <div className="flex justify-between items-start">
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">
              {project.shortTitle}
            </h1>
            <button
              onClick={handleDelete}
              className="px-4 py-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-500/30 rounded-lg text-sm transition-all"
            >
              Удалить проект
            </button>
          </div>

          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-slate-400 text-sm mt-4 hover:text-white"
          >
            {showDetails ? "Скрыть детали" : "Показать детали"}
          </button>

          {showDetails && (
            <div className="mt-4 p-4 bg-slate-900 rounded-lg border border-slate-800">
              <p>
                <strong>{project.title}</strong> 
              </p>
              <br />
              <p>
                {project.description || "Нет описания"}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            to={`/projects/${projectId}/image`}
            className="group p-8 bg-slate-900/80 hover:bg-slate-900 border border-purple-500/20 hover:border-purple-500/60 rounded-2xl transition-all shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">
                🎨
              </div>
              <h2 className="text-2xl font-bold mb-2 group-hover:text-purple-300 transition-colors">
                Генерация Image
              </h2>
              <p className="text-slate-400 text-sm">
                Создавайте изображения для вашего проекта.
              </p>
            </div>
            <div className="mt-6 flex items-center text-purple-400 font-semibold text-sm group-hover:translate-x-1 transition-transform">
              Перейти &rarr;
            </div>
          </Link>
          <Link
            to={`/projects/${projectId}/audio`}
            className="group p-8 bg-slate-900/80 hover:bg-slate-900 border border-indigo-500/20 hover:border-indigo-500/60 rounded-2xl transition-all shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">
                🎙️
              </div>
              <h2 className="text-2xl font-bold mb-2 group-hover:text-indigo-300 transition-colors">
                Генерация Audio / AI
              </h2>
              <p className="text-slate-400 text-sm">
                Интеллектуальная генерация текста и аудиосценариев.
              </p>
            </div>
            <div className="mt-6 flex items-center text-indigo-400 font-semibold text-sm group-hover:translate-x-1 transition-transform">
              Перейти &rarr;
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
