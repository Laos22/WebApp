// server/src/services/geminiService.js
import { GoogleGenAI } from "@google/genai";
import { getDecryptedApiKey } from "./aiProfileResolver.js";

// Дефолтная модель, если профиль пользователя её не задаёт.
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/**
 * Возвращает конфигурацию генерации на основе профиля (если он передан).
 * Если профиль отсутствует — падаем на .env + дефолтную модель.
 *
 * @param {Object|null} profile - Текстовый профиль из настроек
 * @param {string} operation - Название операции для логов
 */
function resolveTextConfig(profile, operation) {
  // Ключ в профиле хранится в зашифрованном виде — расшифровываем его
  // только здесь, непосредственно перед вызовом Gemini API.
  const profileKey = getDecryptedApiKey(profile);
  const apiKey = profileKey || process.env.GEMINI_API_KEY;
  const model = profile?.textSettings?.primaryModel || DEFAULT_GEMINI_MODEL;

  if (!apiKey) {
    throw new Error(
      "API-ключ не найден: ни в профиле, ни в .env (GEMINI_API_KEY)",
    );
  }

  console.log(
    `🤖 [${operation}] Генерация через model="${model}" ` +
      `(источник ключа: ${profileKey ? "профиль" : ".env"})`,
  );

  return { apiKey, model };
}

export async function generateVideoTopic(
  systemPrompt,
  keywords = "",
  profile = null,
) {
  try {
    const { apiKey, model } = resolveTextConfig(profile, "generate-topic");

    const ai = new GoogleGenAI({ apiKey });

    // Формируем детальный промпт с учетом ключевых слов, если они есть
    let userPrompt = `${systemPrompt}\n\n`;
    if (keywords.trim()) {
      userPrompt += `Обязательно используй следующие ключевые слова или контекст при генерации: "${keywords}".\n\n`;
    }
    userPrompt += `Генерируй 3 НОВЫХ и ОРИГИНАЛЬНЫХ идеи для YouTube. Делай идеи конкретными, интересными и актуальными. Ответ выдай СТРОГО в формате JSON массива с 3 объектами. Каждый объект должен иметь ключи: 
- "full_topic" (полное кликбейтное название темы)
- "full_description" (Суть. Как мы планируем зацыпить и удержать зрителя?)
- "short_title" (КРАТКОЕ название темы на УКРАИНСКОМ языке, МАКСИМУМ 3 слова, без кавычек, для использования в названии папки и проекта)

Пример формата:
[
  {
    "full_topic": "Название темы 1",
    "full_description": "Описание 1",
    "short_title": "Коротка назва"
  },
  {
    "full_topic": "Название темы 2",
    "full_description": "Описание 2",
    "short_title": "Коротка назва"
  },
  {
    "full_topic": "Название темы 3",
    "full_description": "Описание 3",
    "short_title": "Коротка назва"
  }
]

Никакого лишнего текста, только JSON массив.`;

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
    });

    // Надежное извлечение текста с учетом разных версий SDK `@google/genai`
    let generatedText = "";
    if (typeof response.text === "function") {
      generatedText = response.text();
    } else if (typeof response.text === "string") {
      generatedText = response.text;
    } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      generatedText = response.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Не удалось получить текстовый ответ от Gemini API");
    }

    // Пытаемся распарсить JSON и вернуть массив объектов
    let parsed;
    try {
      // Очищаем текст от возможных markdown-оберток
      const cleanedText = generatedText
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      parsed = JSON.parse(cleanedText);

      // Проверяем, что это массив
      if (!Array.isArray(parsed)) {
        throw new Error("Ответ не является массивом");
      }

      // Валидация: проверяем, что каждый элемент имеет нужные поля
      for (const item of parsed) {
        if (!item.full_topic || !item.full_description || !item.short_title) {
          throw new Error("Отсутствуют необходимые поля в одном из элементов");
        }
      }
    } catch (parseError) {
      console.error("❌ Ошибка парсинга JSON от Gemini:", generatedText);
      throw new Error(
        "Не удалось распарсить ответ от Gemini API как JSON массив",
      );
    }

    return parsed;
  } catch (error) {
    console.error("❌ Ошибка Gemini API:", error);
    throw error;
  }
}

export async function generateCoverData(
  systemPrompt,
  topic,
  description,
  profile = null,
) {
  try {
    const { apiKey, model } = resolveTextConfig(profile, "generate-cover");

    const ai = new GoogleGenAI({ apiKey });

    const userPrompt = `${systemPrompt}\n\n
Для видео на тему: "${topic}"
Описание видео: "${description}"

Генерируй данные для обложки видео (thumbnail) YouTube. Ответ выдай СТРОГО в формате JSON с следующими ключами:
- "title" (КРАТКОЕ название для обложки, МАКСИМУМ 5 слов на УКРАИНСКОМ, без кавычек)
- "visual_description" (Детальное описание визуальной композиции для обложки в 2-3 предложениях на АНГЛИЙСКОМ для использования в DALL-E или других нейросетей генерации изображений)
- "color_palette" (Рекомендуемая цветовая палитра: массив из 3-4 основных цветов, например ["#FF6B35", "#004E89", "#FFFFFF"])
- "key_elements" (Массив ключевых элементов для визуализации, например ["魔法の書", "闇の力", "光の線"])
- "main_emotion" (Главное эмоциональное воздействие: "интриг", "страх", "восторг" и т.д.)

Пример формата:
{
  "title": "Новый формат контента",
  "visual_description": "Темный фон с неоновыми элементами и главным персонажем в центре",
  "color_palette": ["#FF006E", "#1F1F3D", "#00D9FF"],
  "key_elements": ["неоновый текст", "портал", "частицы"],
  "main_emotion": "интриг"
}

Никакого лишнего текста, только JSON объект.`;

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
    });

    let generatedText = "";
    if (typeof response.text === "function") {
      generatedText = response.text();
    } else if (typeof response.text === "string") {
      generatedText = response.text;
    } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      generatedText = response.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Не удалось получить текстовый ответ от Gemini API");
    }

    let parsed;
    try {
      const cleanedText = generatedText
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      parsed = JSON.parse(cleanedText);

      // Валидация: проверяем необходимые поля
      if (
        !parsed.title ||
        !parsed.visual_description ||
        !parsed.color_palette ||
        !parsed.key_elements ||
        !parsed.main_emotion
      ) {
        throw new Error("Отсутствуют необходимые поля в ответе");
      }
    } catch (parseError) {
      console.error("❌ Ошибка парсинга JSON от Gemini:", generatedText);
      throw new Error(
        "Не удалось распарсить ответ от Gemini API как JSON объект",
      );
    }

    return parsed;
  } catch (error) {
    console.error("❌ Ошибка Gemini API при генерации обложки:", error);
    throw error;
  }
}
