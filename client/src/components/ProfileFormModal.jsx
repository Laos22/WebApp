import { useState } from "react";
import { X } from "lucide-react";
import {
  PROFILE_TYPES,
  PROVIDERS_BY_TYPE,
  getEmptyProfile,
} from "../utils/aiProfileConstants";
import { inputClass, labelClass } from "./profile-settings/settingsStyles";
import TextSettings from "./profile-settings/TextSettings";
import ImageSettings from "./profile-settings/ImageSettings";
import AudioSettings from "./profile-settings/AudioSettings";

/**
 * Модальное окно создания / редактирования профиля AI-провайдера.
 * Полностью контролируемая форма: состояние живёт внутри,
 * наружу отдаётся собранный объект через onSave.
 */
// Примечание: чтобы форма пересоздавалась под другой профиль,
// родитель обязан передать уникальный `key` (например, profile.id ?? "new").
// Тогда state честно инициализируется из props без useEffect-синхронизации.
export default function ProfileFormModal({ initialProfile, onSave, onClose }) {
  const [form, setForm] = useState(() => initialProfile ?? getEmptyProfile());

  const updateField = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Апдейт вложенного блока (textSettings / imageSettings / audioSettings)
  const updateSettings = (block, key, value) =>
    setForm((prev) => ({
      ...prev,
      [block]: { ...prev[block], [key]: value },
    }));

  // При смене типа автоматически подставляем первый доступный провайдер
  const handleTypeChange = (type) => {
    const firstProvider = PROVIDERS_BY_TYPE[type][0].value;
    setForm((prev) => ({ ...prev, type, provider: firstProvider }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Чистим пустые резервные модели перед отправкой на бэкенд
    const cleaned = {
      ...form,
      textSettings: {
        ...form.textSettings,
        fallbackModels: form.textSettings.fallbackModels.filter((m) =>
          m.trim(),
        ),
      },
    };
    onSave(cleaned);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl">
        {/* Шапка */}
        <div className="sticky top-0 flex items-center justify-between p-6 bg-slate-900 border-b border-slate-800 z-10">
          <h2 className="text-xl font-bold text-white">
            {form.id ? "Редактировать профиль" : "Новый профиль"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Название */}
          <div>
            <label className={labelClass}>Название</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              className={inputClass}
              placeholder="Например: OpenRouter Main"
            />
          </div>

          {/* Тип + Провайдер */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Тип</label>
              <select
                value={form.type}
                onChange={(e) => handleTypeChange(e.target.value)}
                className={inputClass}
              >
                {PROFILE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Провайдер</label>
              <select
                value={form.provider}
                onChange={(e) => updateField("provider", e.target.value)}
                className={inputClass}
              >
                {PROVIDERS_BY_TYPE[form.type].map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* API Ключ */}
          <div>
            <label className={labelClass}>API Ключ</label>
            <input
              type="password"
              required
              value={form.apiKey}
              onChange={(e) => updateField("apiKey", e.target.value)}
              className={inputClass}
              placeholder="sk-..."
              autoComplete="off"
            />
          </div>

          {/* Чекбокс "по умолчанию" */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => updateField("isDefault", e.target.checked)}
              className="w-4 h-4 accent-purple-500 rounded"
            />
            <span className="text-sm text-slate-300">
              Использовать по умолчанию для этого типа
            </span>
          </label>

          {/* --- ДИНАМИЧЕСКИЙ БЛОК ТОНКИХ НАСТРОЕК --- */}
          <div className="pt-5 border-t border-slate-800 space-y-5">
            <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wide">
              Тонкие настройки
            </h3>

            {form.type === "text" && (
              <TextSettings
                settings={form.textSettings}
                onChange={(k, v) => updateSettings("textSettings", k, v)}
              />
            )}

            {form.type === "image" && (
              <ImageSettings
                settings={form.imageSettings}
                onChange={(k, v) => updateSettings("imageSettings", k, v)}
              />
            )}

            {form.type === "audio" && (
              <AudioSettings
                settings={form.audioSettings}
                onChange={(k, v) => updateSettings("audioSettings", k, v)}
              />
            )}
          </div>

          {/* Действия */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg transition-all"
            >
              Сохранить профиль
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
