// server/src/services/geminiService.js
import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL = "gemini-3.5-flash"; // Актуальная модель

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
    userPrompt += `Генерируй 3 НОВЫХ и ОРИГИНАЛЬНЫХ идеи для YouTube Shorts видео. Каждую идею оформи так:\n\n🎬 [Название видео]\nОписание: [2-3 предложения о содержании]\n\nДелай идеи конкретными, интересными и актуальными.`;

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

    return generatedText;
  } catch (error) {
    console.error("❌ Ошибка Gemini API:", error);
    throw error;
  }
}