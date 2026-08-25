// server/src/services/geminiService.js
import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL = "gemini-3.5-flash-lite"; // Актуальная модель

export async function generateVideoTopic(systemPrompt, keywords = "") {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY не найден в .env");
    }

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
      model: GEMINI_MODEL,
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

