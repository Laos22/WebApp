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

export const DEFAULT_VISUAL_BIBLE_EDIT_PROMPT = `Отредактируй полную Visual Bible проекта «{{PROJECT_TITLE}}» по инструкции пользователя.

Подтверждённый сценарий:
{{SCRIPT}}

Текущая Visual Bible:
{{CURRENT_VISUAL_BIBLE}}

Инструкция пользователя:
{{INSTRUCTION}}

Верни только JSON полной Visual Bible, а не частичный patch. Используй существующую camelCase-схему. Выполни инструкцию и сохрани всё, чего она не касается. Существующие id сохраняй без изменений только в той же коллекции. Новые элементы возвращай без id, удалённые элементы не возвращай. Не придумывай id и не переноси id между коллекциями. Не добавляй Markdown, ограждения кода, пояснения или служебные поля вне JSON.`;

export const DEFAULT_VISUAL_REFERENCE_PROMPT = `Создай одно чистое референсное изображение для Google Flow.

Проект: {{PROJECT_TITLE}}
Общий визуальный стиль: {{VISUAL_STYLE}}
Правила целостности: {{CONTINUITY_RULES}}
Тип сущности: {{ENTITY_TYPE}}
Название сущности: {{ENTITY_NAME}}
Данные сущности: {{ENTITY_DATA}}

Создай единое изображение сущности, пригодное как ingredient/reference в Google Flow. Не добавляй подписи, текст, интерфейс, водяные знаки, рамки, коллажи или несколько вариантов.`;

export const DEFAULT_REFERENCE_ANALYSIS_PROMPT = `Ты — режиссёр раскадровки и специалист по визуальной консистентности.
Проанализируй утверждённый сценарий проекта «{{PROJECT_TITLE}}» и предложи только те референсы, которые действительно помогут сохранять целостность будущей раскадровки.

СЦЕНАРИЙ:
{{SCRIPT}}

УТВЕРЖДЁННЫЙ ТЕКСТ ДЛЯ ОЗВУЧКИ:
{{VOICEOVER}}

ТЕКУЩИЙ СПИСОК (при повторном анализе):
{{CURRENT_REFERENCES}}

ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ:
{{INSTRUCTIONS}}

Сам реши количество и состав референсов. Учитывай повторяющихся героев, важные локации, узнаваемые предметы, транспорт, животных и другие визуальные элементы. Не создавай карточки для незначительных деталей. Если сохраняешь существующую карточку, верни её id без изменений. Новые карточки возвращай без id.

Верни только JSON вида {"references":[...]}. Для каждой карточки используй поля: id (только для сохранённой существующей карточки), name, type (character/location/object/other), description, reason, mentions (целое число 0 или больше), prompt (может быть пустым или черновым), selected (boolean). Не добавляй Markdown и пояснения вне JSON.`;

export const DEFAULT_REFERENCE_DETAIL_PROMPT = `Подготовь подробный финальный prompt для создания одного чистого референсного изображения в Google Flow.

Проект: {{PROJECT_TITLE}}
Утверждённый сценарий:
{{SCRIPT}}

Карточка референса:
{{REFERENCE}}

Текущий prompt (может быть пустым):
{{CURRENT_PROMPT}}

Дополнительная инструкция пользователя:
{{INSTRUCTION}}

Сам выбери важные визуальные характеристики в зависимости от типа референса. Для персонажа подробно опиши устойчивую внешность, одежду и характерные детали; для локации — пространство, архитектуру, материалы, эпоху и свет; для предмета — форму, масштаб, материал и отличительные признаки. Сохрани факты сценария и не добавляй противоречий. Требуй одно чистое изображение без текста, подписей, UI, водяных знаков, рамок и коллажа, пригодное как ingredient/reference в Google Flow. Верни только готовый prompt без Markdown и комментариев.`;

export const DEFAULT_AUDIO_ADAPTATION_PROMPT = `Ты адаптируешь утверждённый сценарий для озвучки диктором.

Проект: {{PROJECT_TITLE}}
Блоки сценария:
{{SCRIPT_BLOCKS}}

Дополнительные инструкции пользователя:
{{INSTRUCTIONS}}

Для каждого входного блока подготовь живой, плавный текст для чтения вслух. Убери заголовок блока, метки ДИКТОР/ВІЗУАЛ, таймкоды и визуальные указания. Сохрани язык, смысл, факты и порядок исходного текста. Можно расставлять поддерживаемые ElevenLabs паузы и audio tags, если они улучшают звучание.

Критически важно: не объединяй, не удаляй, не добавляй и не переставляй блоки. Для каждого входного id верни ровно один результат с тем же id.

Верни только JSON вида {"blocks":[{"id":"script_block_1","adaptedText":"..."}]}, без Markdown и пояснений.`;

export const DEFAULT_STORYBOARD_PROMPT = `Ты — режиссёр раскадровки YouTube-видео.
Раздели утверждённый текст для озвучки проекта «{{PROJECT_TITLE}}» на визуально осмысленные кадры. Сам выбери количество кадров по содержанию и темпу истории.

ИСХОДНЫЙ СЦЕНАРИЙ — КОНТЕКСТ ДЛЯ ВИЗУАЛИЗАЦИИ:
{{SCRIPT}}

УТВЕРЖДЁННЫЕ БЛОКИ ОЗВУЧКИ — ЕДИНСТВЕННЫЙ ИСТОЧНИК ТЕКСТА КАДРОВ:
{{VOICEOVER_BLOCKS}}

УТВЕРЖДЁННЫЕ РЕФЕРЕНСЫ:
{{REFERENCES}}

ТЕКУЩАЯ РАСКАДРОВКА (при повторной генерации):
{{CURRENT_STORYBOARD}}

ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:
{{INSTRUCTIONS}}

Для каждого кадра верни:
- id — только если сохраняешь существующий кадр;
- sourceVoiceoverBlockId — id блока озвучки, которому принадлежит кадр;
- scriptText — точный непрерывный фрагмент adaptedText этого блока без пересказа, исправлений и сокращений;
- visualDescription — что должно происходить в кадре, на русском;
- prompt — самостоятельный подробный prompt на английском для будущей генерации одного изображения;
- referenceIds — массив только из id утверждённых референсов, которые действительно видны или важны в этом кадре.

Не добавляй референс только потому, что он существует. Не придумывай referenceId. Сохраняй визуальную целостность повторяющихся героев, локаций и объектов. Каждый кадр должен описывать одно изображение, без коллажа, текста, UI и водяных знаков.
Сохрани исходный порядок блоков. Внутри каждого блока используй весь adaptedText ровно один раз: без пропусков, повторов и перестановок.
Верни только JSON вида {"frames":[...]}, без Markdown и пояснений.`;

export const DEFAULT_STORYBOARD_DETAIL_PROMPT = `Ты — режиссёр, оператор и prompt-инженер генерации изображений.
Подготовь подробный финальный prompt на английском языке для одного кадра раскадровки проекта «{{PROJECT_TITLE}}».

КАДР:
{{FRAME}}

ВЫБРАННЫЕ РЕФЕРЕНСЫ:
{{REFERENCES}}

ТЕКУЩИЙ PROMPT:
{{CURRENT_PROMPT}}

ДОПОЛНИТЕЛЬНАЯ ИНСТРУКЦИЯ:
{{INSTRUCTION}}

Опиши одно цельное изображение, непосредственно соответствующее тексту и визуальному описанию кадра. Подробно задай субъект, действие, окружение, эпоху, композицию, план, ракурс камеры, объектив, глубину резкости, освещение, цвет, атмосферу, материалы и важные фоновые детали.
Используй выбранные референсы для сохранения внешности персонажей, локаций и предметов. Не противоречь данным референсов и не придумывай новые узнаваемые особенности для уже определённых сущностей.
Не создавай коллаж, последовательность кадров, разделённый экран, текст, подписи, субтитры, логотипы, интерфейс или водяные знаки.
Верни только готовый prompt без Markdown, заголовков, JSON и комментариев.`;

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
    model: { type: String, default: "gemini-3.1-flash-image" },
    format: { type: String, default: "jpeg" }, // png, webp
    quality: { type: String, default: "standard" }, // standard, hd
    aspectRatio: { type: String, default: "16:9" },
  },

  audioSettings: {
    voiceId: { type: String }, // ID голоса из ElevenLabs
    modelId: { type: String, default: "eleven_v3" },
    speed: { type: Number, default: 1.0 },
    stability: { type: Number, default: 0.5 },
    similarityBoost: { type: Number, default: 0.75 },
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
      audio: { type: String, default: DEFAULT_AUDIO_ADAPTATION_PROMPT },
      timelineDavinci: { type: String, default: "" },
      visualBiblePrompt: { type: String, default: DEFAULT_VISUAL_BIBLE_PROMPT },
      visualBibleEditPrompt: { type: String, default: "" },
      visualReferencePrompt: { type: String, default: "" },
      referenceAnalysisPrompt: { type: String, default: "" },
      referenceDetailPrompt: { type: String, default: "" },
      storyboardPrompt: { type: String, default: "" },
      storyboardDetailPrompt: { type: String, default: "" },
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
