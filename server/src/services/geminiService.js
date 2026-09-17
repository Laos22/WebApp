// server/src/services/geminiService.js
import { GoogleGenAI } from "@google/genai";
import { getDecryptedApiKey } from "./aiProfileResolver.js";
import { DEFAULT_VISUAL_BIBLE_PROMPT, DEFAULT_VISUAL_BIBLE_EDIT_PROMPT } from "../models/Settings.js";

export function buildVisualBiblePrompt(projectTitle, confirmedScript, visualBiblePrompt) {
  const template = typeof visualBiblePrompt === "string" && visualBiblePrompt.trim()
    ? visualBiblePrompt : DEFAULT_VISUAL_BIBLE_PROMPT;
  return template.split("{{PROJECT_TITLE}}").join(projectTitle)
    .split("{{SCRIPT}}").join(confirmedScript);
}

export async function generateVisualBibleDraft(projectTitle, confirmedScript, visualBiblePrompt, profile) {
  try {
    if (!profile || !profile.textSettings?.primaryModel) throw new Error("Missing text profile");
    const { apiKey, model } = resolveTextConfig(profile, "generate-visual-bible");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{
        text: buildVisualBiblePrompt(projectTitle, confirmedScript, visualBiblePrompt),
      }] }],
      config: { responseMimeType: "application/json" },
    });
    const text = typeof response.text === "function" ? response.text()
      : response.text ?? response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new Error("Missing model text");
    return text;
  } catch {
    const error = new Error("Не удалось сгенерировать Visual Bible");
    error.status = 502;
    error.code = "VISUAL_BIBLE_GENERATION_FAILED";
    throw error;
  }
}

export function buildVisualBibleEditPrompt(projectTitle, confirmedScript, currentVisualBible, instruction, visualBibleEditPrompt) {
  const template = typeof visualBibleEditPrompt === "string" && visualBibleEditPrompt.trim()
    ? visualBibleEditPrompt : DEFAULT_VISUAL_BIBLE_EDIT_PROMPT;
  return template.split("{{PROJECT_TITLE}}").join(projectTitle)
    .split("{{SCRIPT}}").join(confirmedScript)
    .split("{{CURRENT_VISUAL_BIBLE}}").join(JSON.stringify(currentVisualBible))
    .split("{{INSTRUCTION}}").join(instruction);
}

export async function editVisualBible(projectTitle, confirmedScript, currentVisualBible, instruction, visualBibleEditPrompt, profile) {
  try {
    if (!profile || !profile.textSettings?.primaryModel) throw new Error("Missing text profile");
    const { apiKey, model } = resolveTextConfig(profile, "edit-visual-bible");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{
        text: buildVisualBibleEditPrompt(projectTitle, confirmedScript, currentVisualBible, instruction, visualBibleEditPrompt),
      }] }],
      config: { responseMimeType: "application/json" },
    });
    const text = typeof response.text === "function" ? response.text()
      : response.text ?? response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new Error("Missing model text");
    return text;
  } catch {
    const error = new Error("Не удалось отредактировать Visual Bible");
    error.status = 502;
    error.code = "VISUAL_BIBLE_EDIT_FAILED";
    throw error;
  }
}


/**
 * Возвращает конфигурацию генерации на основе профиля (если он передан).
 * Если профиль отсутствует — падаем на .env + дефолтную модель.
 *
 * @param {Object|null} profile - Текстовый профиль из настроек
 * @param {string} operation - Название операции для логов
 */
function resolveTextConfig(profile, operation) {
  // Do not log the profile object: it contains the encrypted API key.
  // Ключ в профиле хранится в зашифрованном виде — расшифровываем его
  // только здесь, непосредственно перед вызовом Gemini API.
  const profileKey = getDecryptedApiKey(profile);
  
  const apiKey = profileKey || process.env.GEMINI_API_KEY;
  const model = profile?.textSettings?.primaryModel;

  // console.log(`🔑 [${operation}] Используем ключ из: ${profileKey ? "профиля" : ".env"}`);
  // console.log(`🧠 [${operation}] Используем модель: ${model || "дефолтная"}`);

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



export async function generateScript(systemPrompt, projectDescription, profile) {
  try {
    const { apiKey, model } = resolveTextConfig(profile, "generate-script");

    const ai = new GoogleGenAI({ apiKey });

    const userPrompt = `${systemPrompt}\n\n
Описание проекта: "${projectDescription}"

Никакого лишнего текста.`;
    // console.log("🚀 Отправка запроса на генерацию сценария с промптом:", userPrompt);
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

      parsed = cleanedText;

      // Валидация: проверяем необходимые поля
      // if (
      //   !parsed.script ||
      //   !parsed.scene_breakdown ||
      //   !parsed.estimated_duration
      // ) {
      //   throw new Error("Отсутствуют необходимые поля в ответе");
      // }
    } catch (parseError) {
      console.error("❌ Ошибка парсинга JSON от Gemini:", generatedText);
      throw new Error(
        "Не удалось распарсить ответ от Gemini API как JSON объект",
      );
    }

    return parsed;
  } catch (error) {
    console.error("❌ Ошибка Gemini API при генерации сценария:", error);
    throw error;
  }
}


export async function editScript(currentScript, instruction, profile) {
  const { apiKey, model } = resolveTextConfig(profile, "edit-script");
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ currentScript, instruction }) }] }],
    config: {
      systemInstruction: "Отредактируй сценарий согласно инструкции пользователя. Верни полный обновлённый сценарий, а не список изменений. Сохрани язык исходного сценария. Не добавляй Markdown-обёртки, пояснения и комментарии о редактировании.",
    },
  });
  const text = typeof response.text === "function" ? response.text()
    : response.text ?? response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("Empty edited script");
  const cleaned = text.trim().replace(/^```[^\n]*\n([\s\S]*?)\n```$/, "$1").trim();
  if (!cleaned || cleaned.length > 20000) throw new Error("Invalid edited script length");
  return cleaned;
}
