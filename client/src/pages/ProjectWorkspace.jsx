import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import axios from "axios";

import { getProject, getVideoPlan } from "../services/api";

const API_URL = String(import.meta.env.VITE_SERVER_URL || "").replace(/\/$/, "");

export default function ProjectWorkspace() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    let active = true;
    setVideoAvailable(false);
    getVideoPlan(projectId).then(data => { if (active) setVideoAvailable(data.frames.some(f => f.hasImage)); }).catch(() => {});
    getProject(projectId).then(data => {
      if (active) setProject(data.project);
    }).catch(err => {
      console.error("Ошибка при загрузке проекта:", err);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [projectId]);

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
              <p>{project.description || "Нет описания"}</p>
              {project.script && (
                <section className="p-6 bg-slate-900 rounded-2xl border border-emerald-500/20 space-y-3">
                  <h2 className="text-xl font-bold">Сценарий · {project.script.status === "confirmed" ? "Подтверждён" : "Черновик"} · Редакция {project.script.revision}</h2>
                  <pre className="text-slate-300 whitespace-pre-wrap font-sans max-h-72 overflow-y-auto">{project.script.content}</pre>
                  <Link to={`/projects/${projectId}/script`} className="text-emerald-400 inline-block">Открыть сценарий</Link>
                </section>
              )}
            </div>
          )}
        </div>

        

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {project.storyboard?.status === 'confirmed' && videoAvailable && <Link
            to={`/projects/${projectId}/video`} className="p-8 bg-slate-900 rounded-2xl border border-purple-500/40">
            <h2 className="text-2xl font-bold mb-2">Работа с видео</h2>
            <p className="text-slate-400 text-sm">Анализ кадров, выбор движения и подготовка видеопромтов.</p>
          </Link>}
          <Link
            to={`/projects/${projectId}/script`}
            className="group p-8 bg-slate-900/80 hover:bg-slate-900 border border-emerald-500/20 hover:border-emerald-500/60 rounded-2xl transition-all shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">
                📝
              </div>
              <h2 className="text-2xl font-bold mb-2 group-hover:text-emerald-300 transition-colors">
                Генерация сценария
              </h2>
              <p className="text-slate-400 text-sm">
                Интеллектуальная генерация сценария для вашего видео.
              </p>
            </div>
            <div className="mt-6 flex items-center text-emerald-400 font-semibold text-sm group-hover:translate-x-1 transition-transform">
              Перейти &rarr;
            </div>
          </Link>

          {project.voiceover?.status === "confirmed" && <Link
            to={`/projects/${projectId}/references`}
            className="group p-8 bg-slate-900/80 hover:bg-slate-900 border border-fuchsia-500/20 hover:border-fuchsia-500/60 rounded-2xl transition-all shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-fuchsia-600/20 border border-fuchsia-500/30 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">🎭</div>
              <h2 className="text-2xl font-bold mb-2 group-hover:text-fuchsia-300 transition-colors">Работа с референсами</h2>
              <p className="text-slate-400 text-sm">ИИ предложит героев, локации и предметы, важные для целостной раскадровки.</p>
            </div>
            <div className="mt-6 flex items-center text-fuchsia-400 font-semibold text-sm group-hover:translate-x-1 transition-transform">Перейти &rarr;</div>
          </Link>}

          <Link
            to={`/projects/${projectId}/cover`}
            className="group p-8 bg-slate-900/80 hover:bg-slate-900 border border-yellow-500/20 hover:border-yellow-500/60 rounded-2xl transition-all shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-yellow-600/20 border border-yellow-500/30 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">
                🖼️
              </div>
              <h2 className="text-2xl font-bold mb-2 group-hover:text-yellow-300 transition-colors">
                Генерация обложки
              </h2>
              <p className="text-slate-400 text-sm">
                Генерация названия и изображения для обложки видео.
              </p>
            </div>
            <div className="mt-6 flex items-center text-yellow-400 font-semibold text-sm group-hover:translate-x-1 transition-transform">
              Перейти &rarr;
            </div>
          </Link>

          {project.script?.status === "confirmed" && <Link
            to={`/projects/${projectId}/audio`}
            className="group p-8 bg-slate-900/80 hover:bg-slate-900 border border-indigo-500/20 hover:border-indigo-500/60 rounded-2xl transition-all shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">
                🎙️
              </div>
              <h2 className="text-2xl font-bold mb-2 group-hover:text-indigo-300 transition-colors">
                Генерация озвучки
              </h2>
              <p className="text-slate-400 text-sm">
                Интеллектуальная генерация аудиосценариев.
              </p>
            </div>
            <div className="mt-6 flex items-center text-indigo-400 font-semibold text-sm group-hover:translate-x-1 transition-transform">
              Перейти &rarr;
            </div>
          </Link>}

          {project.voiceover?.status === "confirmed" && project.storyboard?.status === "confirmed" && <Link
            to={`/projects/${projectId}/music`}
            className="group p-8 bg-slate-900/80 hover:bg-slate-900 border border-amber-500/20 hover:border-amber-500/60 rounded-2xl transition-all shadow-xl flex flex-col justify-between"
          >
            <div><div className="w-12 h-12 rounded-xl bg-amber-600/20 border border-amber-500/30 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">🎵</div><h2 className="text-2xl font-bold mb-2 group-hover:text-amber-300 transition-colors">Фоновая музыка</h2><p className="text-slate-400 text-sm">AI-анализ проекта и генерация инструментальной дорожки.</p></div>
            <div className="mt-6 flex items-center text-amber-400 font-semibold text-sm group-hover:translate-x-1 transition-transform">Перейти &rarr;</div>
          </Link>}

          {project.script?.status === "confirmed" && <Link
            to={`/projects/${projectId}/sounds`}
            className="group p-8 bg-slate-900/80 hover:bg-slate-900 border border-fuchsia-500/20 hover:border-fuchsia-500/60 rounded-2xl transition-all shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-fuchsia-600/20 border border-fuchsia-500/30 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">🔊</div>
              <h2 className="text-2xl font-bold mb-2 group-hover:text-fuchsia-300 transition-colors">Звуки и эффекты</h2>
              <p className="text-slate-400 text-sm">Создание атмосфер и звуковых эффектов через ElevenLabs.</p>
            </div>
            <div className="mt-6 flex items-center text-fuchsia-400 font-semibold text-sm group-hover:translate-x-1 transition-transform">Перейти &rarr;</div>
          </Link>}

          {project.voiceover?.status === "confirmed" && project.referencePlan?.status === "confirmed" && <Link
            to={`/projects/${projectId}/image`}
            className="group p-8 bg-slate-900/80 hover:bg-slate-900 border border-purple-500/20 hover:border-purple-500/60 rounded-2xl transition-all shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">
                🎨
              </div>
              <h2 className="text-2xl font-bold mb-2 group-hover:text-purple-300 transition-colors">
                Работа с изображениями
              </h2>
              <p className="text-slate-400 text-sm">
                Раскадровка, детализация промтов и генерация изображений по кадрам.
              </p>
            </div>
            <div className="mt-6 flex items-center text-purple-400 font-semibold text-sm group-hover:translate-x-1 transition-transform">
              Перейти &rarr;
            </div>
          </Link>}

          {project.voiceover?.status === "confirmed" && project.storyboard?.status === "confirmed" && <Link
            to={`/projects/${projectId}/davinci`}
            className="group p-8 bg-slate-900/80 hover:bg-slate-900 border border-cyan-500/20 hover:border-cyan-500/60 rounded-2xl transition-all shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">🎬</div>
              <h2 className="text-2xl font-bold mb-2 group-hover:text-cyan-300 transition-colors">Экспорт DaVinci Resolve</h2>
              <p className="text-slate-400 text-sm">Проверка файлов проекта и подготовка монтажного FCPXML.</p>
            </div>
            <div className="mt-6 flex items-center text-cyan-400 font-semibold text-sm group-hover:translate-x-1 transition-transform">Перейти &rarr;</div>
          </Link>}
        </div>
      </div>
    </div>
  );
}
