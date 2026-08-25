// client/src/hooks/useGenerateTopic.js
import { useState } from "react";

const API_URL = import.meta.env.VITE_SERVER_URL;

export function useGenerateTopic() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [topics, setTopics] = useState([]); // 👈 Массив тем вместо одной

  const generateTopic = async (keywords = "") => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/projects/generate-topic`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ keywords }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Ошибка при генерации темы");
      }

      // data.topic теперь является массивом объектов
      setTopics(data.topic);
      return data.topic;
    } catch (err) {
      const errorMessage = err.message || "Неизвестная ошибка";
      setError(errorMessage);
      console.error("Ошибка:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return { generateTopic, isLoading, error, topics, setTopics };
}
