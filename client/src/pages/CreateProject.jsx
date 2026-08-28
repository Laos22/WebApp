// client/src/pages/CreateProject.jsx
import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useGenerateTopic } from "../hooks/useGenerateTopic";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

export default function CreateProject() {
  const navigate = useNavigate();
  const { generateTopic, isLoading, error, topics, setTopics } = useGenerateTopic();
  const [systemPrompt, setSystemPrompt] = useState("");
  const [keywords, setKeywords] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // 👈 Храним редактируемые названия для каждой темы
  const [editedTitles, setEditedTitles] = useState({});

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
    await generateTopic(keywords);
    // Инициализируем редактируемые названия после генерации
    setEditedTitles({});
  };

  // 👈 Обработчик изменения названия темы
  const handleTitleChange = (index, newTitle) => {
    setEditedTitles(prev => ({
      ...prev,
      [index]: newTitle
    }));
  };

  // 👈 Обработчик создания проекта из темы
  const handleCreateProject = async (topicItem, index) => {
    setCreatingProject(true);
    
    // Используем отредактированное название или исходное
    const finalShortTitle = editedTitles[index] || topicItem.short_title;
    
    try {
      const response = await fetch(`${SERVER_URL}/api/projects/create-from-topic`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          topic: topicItem.full_topic,
          description: topicItem.full_description,
          short_title: finalShortTitle,
          keywords: keywords,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Ошибка при создании проекта");
      }

      alert(
        `✅ Проект успешно создан!\n\n` +
        `📁 Название: ${data.shortTitle}\n` +
        `📁 Путь к проекту: ${data.projectPath}\n` +
        `🆔 ID: ${data.projectId}\n` +
        `💡 Теперь вы можете писать сценарий для этой темы.`
      );
      
      // нужно реализовать создание проекта и возвращать его ID, чтобы потом перейти на страницу редактора
      // Временная заглушка - позже будет переход на /editor/:projectId
      // navigate(`/editor/${data.projectId}`);

    } catch (err) {
      const errorMessage = err.message || "Неизвестная ошибка";
      alert(`❌ Ошибка: ${errorMessage}`);
      console.error("Ошибка:", err);
    } finally {
      setCreatingProject(false);
    }
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

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-slate-300">
              🔑 Ключевые слова или контекст:
            </label>
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

        {topics.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-slate-300 mb-2">
              ✅ Сгенерированные темы (выберите подходящую):
            </h3>
            
            <div className="grid gap-4">
              {topics.map((topicItem, index) => (
                <div
                  key={index}
                  className="flex flex-col bg-slate-950 rounded-xl border border-slate-800 overflow-hidden hover:border-purple-500 transition-colors"
                >
                  <div className="p-4 border-b border-slate-800">
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-sm">
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-white text-base leading-tight">
                          {topicItem.full_topic}
                        </h4>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 p-4 max-h-96 overflow-y-auto">
                    <p className="text-sm text-slate-300 whitespace-pre-wrap break-words">
                      {topicItem.full_description}
                    </p>
                  </div>

                  {/* 👈 Поле для редактирования короткого названия */}
                  <div className="p-4 bg-slate-900/50 border-t border-slate-800 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">
                        📝 Короткая назва проекту (для папки та сайту):
                      </label>
                      <input
                        type="text"
                        value={editedTitles[index] ?? topicItem.short_title}
                        onChange={(e) => handleTitleChange(index, e.target.value)}
                        placeholder="Введіть коротку назву..."
                        maxLength={50}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Максимум 4 слова, українською. Поточна: {editedTitles[index] ?? topicItem.short_title}
                      </p>
                    </div>

                    <button
                      onClick={() => handleCreateProject(topicItem, index)}
                      disabled={creatingProject}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 touch-manipulation"
                    >
                      <span>📁</span>
                      <span>
                        {creatingProject ? "Створення..." : "Створити проект"}
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}