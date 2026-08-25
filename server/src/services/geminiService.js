// server/src/services/geminiService.js
import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL = "gemini-3.5-flash";

export async function generateVideoTopic(systemPrompt) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY не найден в .env");
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${systemPrompt}`,
            },
          ],
        },
      ],
    });

    // ИСПРАВКА: Правильно обращаемся к тексту
    // response может быть объектом с различной структурой в зависимости от версии SDK
    let generatedText;
    
    if (typeof response.text === 'function') {
      generatedText = response.text();
    } else if (response.text && typeof response.text === 'string') {
      generatedText = response.text;
    } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      generatedText = response.candidates[0].content.parts[0].text;
    } else {
      console.log("📦 Структура ответа:", JSON.stringify(response, null, 2));
      throw new Error("Не удалось извлечь текст из ответа API");
    }

    return generatedText;
  } catch (error) {
    console.error("❌ Ошибка Gemini API:", error);
    throw error;
  }
}