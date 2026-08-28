import {
  IMAGE_FORMATS,
  IMAGE_QUALITIES,
  IMAGE_ASPECT_RATIOS,
} from "../../utils/aiProfileConstants";
import { inputClass, labelClass } from "./settingsStyles";

/**
 * Тонкие настройки для профилей генерации изображений:
 * модель, формат, качество и соотношение сторон.
 */
export default function ImageSettings({ settings, onChange }) {
  const selects = [
    { key: "format", label: "Формат", options: IMAGE_FORMATS },
    { key: "quality", label: "Качество", options: IMAGE_QUALITIES },
    {
      key: "aspectRatio",
      label: "Соотношение сторон",
      options: IMAGE_ASPECT_RATIOS,
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>Модель</label>
        <input
          type="text"
          value={settings.model}
          onChange={(e) => onChange("model", e.target.value)}
          className={inputClass}
          placeholder="imagen-3.0-generate-002"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {selects.map(({ key, label, options }) => (
          <div key={key}>
            <label className={labelClass}>{label}</label>
            <select
              value={settings[key]}
              onChange={(e) => onChange(key, e.target.value)}
              className={inputClass}
            >
              {options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
