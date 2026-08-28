import { Plus, Trash2 } from "lucide-react";
import { inputClass, labelClass } from "./settingsStyles";

/**
 * Тонкие настройки для текстовых профилей:
 * основная модель, список fallback-моделей и температура.
 */
export default function TextSettings({ settings, onChange }) {
  const handleFallbackChange = (index, value) => {
    const next = [...settings.fallbackModels];
    next[index] = value;
    onChange("fallbackModels", next);
  };

  const addFallback = () =>
    onChange("fallbackModels", [...settings.fallbackModels, ""]);

  const removeFallback = (index) =>
    onChange(
      "fallbackModels",
      settings.fallbackModels.filter((_, i) => i !== index),
    );

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>Основная модель</label>
        <input
          type="text"
          value={settings.primaryModel}
          onChange={(e) => onChange("primaryModel", e.target.value)}
          className={inputClass}
          placeholder="google/gemini-pro"
        />
      </div>

      <div>
        <label className={labelClass}>Резервные модели (fallback)</label>
        <div className="space-y-2">
          {settings.fallbackModels.map((model, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={model}
                onChange={(e) => handleFallbackChange(i, e.target.value)}
                className={inputClass}
                placeholder="anthropic/claude-3-haiku"
              />
              <button
                type="button"
                onClick={() => removeFallback(i)}
                className="px-3 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 rounded-xl transition-colors"
                aria-label="Удалить модель"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addFallback}
          className="mt-2 flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 transition-colors"
        >
          <Plus size={16} /> Добавить резервную модель
        </button>
      </div>

      <div>
        <label className={labelClass}>
          Температура:{" "}
          <span className="text-purple-400">{settings.temperature}</span>
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={settings.temperature}
          onChange={(e) => onChange("temperature", parseFloat(e.target.value))}
          className="w-full accent-purple-500"
        />
      </div>
    </div>
  );
}
