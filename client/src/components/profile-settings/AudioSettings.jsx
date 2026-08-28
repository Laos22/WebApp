import { inputClass, labelClass } from "./settingsStyles";

/**
 * Тонкие настройки для аудио-профилей (ElevenLabs TTS).
 * Ключи полей строго совпадают с audioSettings из aiProfileConstants:
 * voiceId, speed, stability, speakerBoost.
 */
export default function AudioSettings({ settings, onChange }) {
  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>Voice ID</label>
        <input
          type="text"
          value={settings.voiceId}
          onChange={(e) => onChange("voiceId", e.target.value)}
          className={inputClass}
          placeholder="21m00Tcm4TlvDq8ikWAM"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>
            Скорость: <span className="text-purple-400">{settings.speed}x</span>
          </label>
          <input
            type="range"
            min="0.25"
            max="4"
            step="0.05"
            value={settings.speed}
            onChange={(e) => onChange("speed", parseFloat(e.target.value))}
            className="w-full accent-purple-500"
          />
        </div>
        <div>
          <label className={labelClass}>
            Стабильность:{" "}
            <span className="text-purple-400">{settings.stability}</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.stability}
            onChange={(e) => onChange("stability", parseFloat(e.target.value))}
            className="w-full accent-purple-500"
          />
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={settings.speakerBoost}
          onChange={(e) => onChange("speakerBoost", e.target.checked)}
          className="w-4 h-4 accent-purple-500 rounded"
        />
        <span className="text-sm text-slate-300">Speaker Boost</span>
      </label>
    </div>
  );
}
