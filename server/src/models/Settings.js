import mongoose from "mongoose";

// Единый дефолтный системный промпт.
// Экспортируем, чтобы роуты/сервисы не дублировали строку и не расходились.
export const DEFAULT_SYSTEM_PROMPT =
  "Ты — профессиональный YouTube-сценарист. Твоя задача — создавать виральные сценарии.";

export const DEFAULT_VISUAL_BIBLE_PROMPT = `Создай Visual Bible проекта «{{PROJECT_TITLE}}» на основе подтверждённого сценария:
{{SCRIPT}}

Используй подтверждённый сценарий как источник фактов. Явно отделяй факты сценария от художественных решений и не выдавай придуманные детали за факты.
Сохраняй единый визуальный стиль и визуальную целостность персонажей, локаций и объектов во всех сценах.
Создавай отдельные визуальные режимы для разных времён или типов сцен, сохраняя общий стиль проекта.
Пиши названия и пояснения на русском языке. Добавляй visual anchors на английском языке для будущих генераторов изображений.
Верни только валидный JSON с точной полной структурой ниже, заполнив значения по сценарию. Используй только указанные ключи в camelCase, без snake_case и суффиксов _ru/_en. Поля с окончанием En заполняй на английском языке.
Объекты в массивах показывают структуру одного элемента. Если соответствующих сущностей нет в сценарии, верни пустой массив; не создавай элементы только ради заполнения структуры. Не добавляй ID и служебные метаданные.
{
  "visualStyle": {
    "concept": "",
    "realism": "",
    "colorPalette": [],
    "lightingRules": [],
    "cameraRules": [],
    "textureRules": [],
    "promptAnchorEn": "",
    "avoid": []
  },
  "visualModes": [
    {
      "name": "",
      "purpose": "",
      "styleEn": "",
      "paletteEn": "",
      "lightingOptionsEn": [],
      "cameraOptionsEn": [],
      "atmosphereOptionsEn": [],
      "avoidEn": []
    }
  ],
  "continuityRules": [],
  "characters": [
    {
      "name": "",
      "sourceFacts": [],
      "designDecisions": [],
      "role": "",
      "recurring": false,
      "identityAnchorEn": "",
      "defaultWardrobeEn": "",
      "optionalPropsEn": []
    }
  ],
  "locations": [
    {
      "name": "",
      "sourceFacts": [],
      "designDecisions": [],
      "identityAnchorEn": "",
      "variableConditionsEn": []
    }
  ],
  "objects": [
    {
      "name": "",
      "sourceFacts": [],
      "designDecisions": [],
      "visualAnchorEn": ""
    }
  ]
}
Не добавляй Markdown, ограждения кода и пояснения вне JSON.`;

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

const driveCredentialsSchema = new mongoose.Schema({
  version: { type: Number, required: true, enum: [1] },
  revision: {
    type: Number,
    required: true,
    min: 1,
    validate: Number.isInteger,
  },
  ciphertext: { type: String, required: true },
}, { _id: false });

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
      visualBiblePrompt: { type: String, default: DEFAULT_VISUAL_BIBLE_PROMPT },
    },

    driveCredentials: { type: driveCredentialsSchema, default: null, select: false },
    // Legacy plaintext is read only through driveTokenService.
    driveTokens: { type: Object, default: null, select: false },
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
