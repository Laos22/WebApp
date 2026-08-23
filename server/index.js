import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import authRoutes from "./src/routes/authRoutes.js";
import configRoutes from "./src/routes/configRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Маршруты
app.use('/auth', authRoutes);
app.use('/api/settings', configRoutes);

// Эндпоинт генерации контента
app.post("/api/generate", async (req, res) => {
  try {
    const { prompt, type, style } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Промпт обязателен для генерации" });
    }

    // Проверяем, передал ли пользователь свой API-ключ в заголовке,
    // иначе используем дефолтный из server/.env
    const userApiKey = req.headers["x-goog-api-key"];
    const apiKey = userApiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(401).json({
        error:
          "API-ключ Google AI не найден. Укажите его в настройках приложения или на сервере в .env",
      });
    }

    // Инициализируем Google Gen AI SDK
    const ai = new GoogleGenAI({ apiKey });

    // В зависимости от типа запроса выбираем модель Gemini
    // Для текста/аудиосценариев используем gemini-2.5-flash (или аналогичную актуальную модель)
    const modelName = "gemini-2.5-flash";

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Сгенерируй контент на основе следующего запроса.\nТип контента: ${type || "text"}\nСтиль: ${style || "standard"}\nПромпт: ${prompt}`,
            },
          ],
        },
      ],
    });

    const generatedText = response.text();

    res.json({
      success: true,
      result: {
        content: generatedText,
        prompt,
        type: type || "text",
        timestamp: new Date().toLocaleTimeString(),
      },
    });
  } catch (error) {
    console.error("Gemini API Error:", error);
    res.status(500).json({
      error:
        error.message || "Произошла ошибка при обращении к Google AI Studio",
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "AI Backend is running" });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

