const API_BASE_URL = "http://localhost:5001/api";

/**
 * Универсальная функция для отправки запроса генерации на бэкенд
 * @param {Object} payload - Данные запроса (prompt, type, style и т.д.)
 */
export async function generateContent(payload) {
  // Получаем личный API-ключ пользователя из localStorage (если он есть)
  const userApiKey = localStorage.getItem("google_ai_api_key") || "";

  try {
    const response = await fetch(`${API_BASE_URL}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(userApiKey ? { "x-goog-api-key": userApiKey } : {}),
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ошибка при генерации контента на сервере");
    }

    return data;
  } catch (error) {
    console.error("API Error:", error);
    throw error;
  }
}
