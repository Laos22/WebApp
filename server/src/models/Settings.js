import mongoose from "mongoose";

// Единый дефолтный системный промпт.
// Экспортируем, чтобы роуты/сервисы не дублировали строку и не расходились.
export const DEFAULT_SYSTEM_PROMPT =
  "Ты — профессиональный YouTube-сценарист. Твоя задача — создавать виральные сценарии.";

// Схема для отдельного профиля провайдера
const profileSchema = new mongoose.Schema({
  name: { type: String, required: true }, // Например: "OpenRouter Main"
  type: {
    type: String,
    enum: ["text", "image", "audio"],
    required: true,
  },
  provider: {
    type: String,
    // Можно расширять список
    enum: ["openrouter", "google_studio", "elevenlabs", "openai", "midjourney"],
    required: true,
  },
  apiKey: { type: String, required: true },
  isDefault: { type: Boolean, default: false }, // Флаг, что этот профиль используется по умолчанию для своего типа

  // --- ТОНКИЕ НАСТРОЙКИ (заполняется только нужный блок) ---

  textSettings: {
    primaryModel: { type: String }, // Например: "google/gemini-pro"
    fallbackModels: [{ type: String }], // Массив резервных моделей: ["anthropic/claude-3-haiku", "gemma-7b"]
    temperature: { type: Number, default: 0.7 },
  },

  imageSettings: {
    model: { type: String },
    format: { type: String, default: "jpeg" }, // png, webp
    quality: { type: String, default: "standard" }, // standard, hd
    aspectRatio: { type: String, default: "16:9" },
  },

  audioSettings: {
    voiceId: { type: String }, // ID голоса из ElevenLabs
    speed: { type: Number, default: 1.0 },
    stability: { type: Number, default: 0.5 },
    speakerBoost: { type: Boolean, default: true },
  },
});

// Основная схема настроек
const settingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    // Массив профилей
    profiles: [profileSchema],

    // // Ключ внешнего AI-провайдера (используется как fallback вне системы профилей)
    // apiKey: { type: String, default: "" },

    // Активный системный промпт: применяется при генерации темы и обложки
    systemPrompt: { type: String, default: DEFAULT_SYSTEM_PROMPT },

    // Специализированные промпты по этапам пайплайна
    prompts: {
      theme: { type: String, default: "" },
      script: { type: String, default: "" },
      cover: { type: String, default: "" },
      audio: { type: String, default: "" },
      timelineDavinci: { type: String, default: "" },
    },

    driveTokens: { type: Object, default: null },
    driveFileId: { type: String, default: null },
  },
  {
    // Mongoose автоматически ведёт поля createdAt и updatedAt.
    // Это заменяет ручной pre("save")-хук и устраняет ошибку
    // "next is not a function".
    timestamps: true,
  },
);

const Settings = mongoose.model("Settings", settingsSchema);
export default Settings;
