import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";

export default function CreateProject() {
  const navigate = useNavigate();
  const [method, setMethod] = useState("manual");
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [generatedOptions, setGeneratedOptions] = useState([]);
  const [selectedOption, setSelectedOption] = useState(null);
  const [systemPrompt, setSystemPrompt] = useState("");

  const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5001";

  // Загрузить системный промпт при монтировании
  useEffect(() => {
    fetchSystemPrompt();
  }, []);
  const fetchSystemPrompt = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/settings/prompt`);
      if (response.ok) {
        const data = await response.json();
        setSystemPrompt(data.systemPrompt);
      }
    } catch (e) {
      console.error("Ошибка загрузки системного промпта:", e);
      // Fallback
      setSystemPrompt(
        localStorage.getItem("ai_system_prompt") ||
          "Ты — профессиональный YouTube-сценарист.",
      );
    }
  };

  const handleGenerate = async () => {
    if (method === "manual" && !prompt.trim()) return;

    setIsLoading(true);

    try {
      // TODO: Здесь будет реальный запрос к API для генерации вариантов
      // Пока используем имитацию
      setTimeout(() => {
        setGeneratedOptions([
          {
            id: 1,
            title: "Тайны квантовой физики в Shorts",
            description:
              "Увлекательное объяснение основ квантовой механики за 60 секунд.",
          },
          {
            id: 2,
            title: "Почему AI изменит ваш рабочий стол",
            description:
              "Разбор инструментов, которые ускорят вашу работу в 10 раз.",
          },
          {
            id: 3,
            title: "История программирования: от перфокарт до GPT",
            description: "Краткий экскурс в эволюцию IT.",
          },
        ]);
        setIsLoading(false);
      }, 1500);
    } catch (e) {
      console.error("Ошибка генерации:", e);
      setIsLoading(false);
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
        {/* Информационный блок */}
        {systemPrompt && (
          <div className="p-4 bg-purple-900/20 border border-purple-500/30 rounded-xl text-sm text-slate-300">
            <p className="font-medium text-purple-300 mb-1">
              📌 Активный системный промпт:
            </p>
            <p className="line-clamp-2">{systemPrompt}</p>
          </div>
        )}

        {/* Переключатель методов */}
        <div className="flex p-1 bg-slate-950 border border-slate-800 rounded-xl">
          <button
            onClick={() => setMethod("manual")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${method === "manual" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            Своя идея
          </button>
          <button
            onClick={() => setMethod("trends")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${method === "trends" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            Анализ трендов
          </button>
        </div>

        {method === "manual" ? (
          <>
            <textarea
              className="w-full h-32 p-4 bg-slate-950 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500 transition-all"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Опишите вашу идею..."
            />
            <button
              onClick={handleGenerate}
              disabled={isLoading || !prompt.trim()}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 text-white py-3 rounded-xl font-semibold transition-all"
            >
              {isLoading ? "Генерация..." : "Сгенерировать структуру"}
            </button>
          </>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={isLoading}
            className="w-full py-4 border-2 border-dashed border-slate-700 rounded-xl text-slate-400 hover:border-purple-500 hover:text-purple-400 transition-all"
          >
            {isLoading ? "Анализируем YouTube..." : "Начать анализ трендов"}
          </button>
        )}

        {/* Список вариантов */}
        {generatedOptions.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-slate-800 animate-fadeIn">
            <h2 className="text-lg font-semibold text-white">
              Выберите вариант:
            </h2>
            {generatedOptions.map((opt) => (
              <div
                key={opt.id}
                onClick={() => setSelectedOption(opt)}
                className={`p-4 bg-slate-950 border rounded-xl cursor-pointer transition-all ${selectedOption?.id === opt.id ? "border-purple-500 bg-purple-900/20" : "border-slate-800 hover:border-slate-600"}`}
              >
                <h3 className="text-white font-medium">{opt.title}</h3>
                <p className="text-slate-400 text-sm mt-1">{opt.description}</p>
              </div>
            ))}

            {selectedOption && (
              <button
                onClick={() => navigate("/")}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-semibold transition-all"
              >
                Создать проект на основе выбранного
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
