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
  image: [{ value: "google_studio", label: "Google Studio" }],
  audio: [{ value: "elevenlabs", label: "ElevenLabs" }],
};

export const IMAGE_FORMATS = ["png", "webp"];
export const IMAGE_QUALITIES = ["standard", "hd"];
export const IMAGE_ASPECT_RATIOS = ["16:9", "1:1", "9:16"];

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
    format: "png",
    quality: "standard",
    aspectRatio: "16:9",
  },
  audioSettings: {
    voiceId: "",
    speed: 1.0,
    stability: 0.5,
    speakerBoost: true,
  },
});
