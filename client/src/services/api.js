const API_BASE_URL = "http://localhost:5001/api";

/**
 * Универсальная функция для отправки запроса генерации на бэкенд
 * @param {Object} payload - Данные запроса (prompt, type, style и т.д.)
 */
export async function generateContent(payload) {

  try {
    const response = await fetch(`${API_BASE_URL}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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

// Project workflow requests use the same server and session as the existing pages.
async function projectRequest(projectId, suffix = "", method = "GET", body) {
  const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/api/projects/${projectId}${suffix}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || "Ошибка запроса проекта");
  return data;
}

export const getProject = (id) => projectRequest(id);
export const generateProjectScript = (id, payload) => projectRequest(id, "/generate-script", "POST", payload);
export const saveProjectScript = (id, content, revision) => projectRequest(id, "/script", "PUT", { content, revision });
export const confirmProjectScript = (id, revision) => projectRequest(id, "/script/confirm", "POST", { revision });
