/**
 * Единый источник правды для конфигурации AI-профилей.
 * Держим бизнес-логику "какой провайдер доступен для какого типа" здесь,
 * чтобы UI-компоненты оставались тонкими и легко тестировались.
 */

// Типы генерации
export const PROFILE_TYPES = [
  { value: "text", label: "Текст 📝" },
  { value: "image", label: "Изображение 🖼️" },
  { value: "audio", label: "Звук 🔊" },
];

// Доступные провайдеры в зависимости от типа профиля.
// Значения (value) должны совпадать с enum в бэкенд-модели Settings.js.
export const PROVIDERS_BY_TYPE = {
  text: [
    { value: "openrouter", label: "OpenRouter" },
    { value: "google_studio", label: "Google Studio" },
  ],
  image: [
    { value: "google_studio", label: "Google Studio" },
    { value: "openrouter", label: "OpenRouter" },
  ],
  audio: [{ value: "elevenlabs", label: "ElevenLabs" }],
};

export const IMAGE_FORMATS = ["png", "webp", "jpeg"];
export const IMAGE_QUALITIES = ["standard", "hd"];
export const IMAGE_ASPECT_RATIOS = ["16:9", "1:1", "9:16"];

export const ELEVENLABS_MODELS = [
  { value: "eleven_v3", label: "Eleven v3 — выразительная", characterLimit: 5000 },
  { value: "eleven_multilingual_v2", label: "Multilingual v2 — длинная озвучка", characterLimit: 10000 },
  { value: "eleven_flash_v2_5", label: "Flash v2.5 — быстрая", characterLimit: 40000 },
  { value: "eleven_flash_v2", label: "Flash v2 — быстрая", characterLimit: 30000 },
];

export const getElevenLabsCharacterLimit = (modelId) =>
  ELEVENLABS_MODELS.find(model => model.value === modelId)?.characterLimit ?? null;

// Человекочитаемые лейблы для отображения на карточках
export const TYPE_LABELS = {
  text: "Текст",
  image: "Изображение",
  audio: "Звук",
};

export const PROVIDER_LABELS = {
  openrouter: "OpenRouter",
  google_studio: "Google Studio",
  elevenlabs: "ElevenLabs",
  openai: "OpenAI",
  midjourney: "Midjourney",
};

// Дефолтное состояние формы. Держим все под-настройки заранее,
// чтобы контролируемые инпуты никогда не превращались в uncontrolled.
export const getEmptyProfile = () => ({
  id: null,
  name: "",
  type: "text",
  provider: "openrouter",
  apiKey: "",
  isDefault: false,
  textSettings: {
    primaryModel: "",
    fallbackModels: [],
    temperature: 0.7,
  },
  imageSettings: {
    model: "",
    format: "jpeg",
    quality: "standard",
    aspectRatio: "16:9",
  },
  audioSettings: {
    voiceId: "",
    modelId: "eleven_v3",
    speed: 1.0,
    stability: 0.5,
    similarityBoost: 0.75,
    speakerBoost: true,
  },
});
