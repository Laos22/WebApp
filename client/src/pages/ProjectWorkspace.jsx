import React from "react";
import { useParams, Link } from "react-router-dom";

export default function ProjectWorkspace() {
  const { projectId } = useParams();

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
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">
            Проект: #{projectId} 🛠️
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Выберите инструмент для генерации контента внутри этого проекта.
          </p>
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
