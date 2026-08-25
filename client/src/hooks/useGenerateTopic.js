// client/src/hooks/useGenerateTopic.js
import { useState } from "react";

const API_URL = import.meta.env.VITE_SERVER_URL;

export function useGenerateTopic() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [topic, setTopic] = useState(null);

  const generateTopic = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/projects/generate-topic`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // Отправляем куки с sessionId
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Ошибка при генерации темы");
      }

      setTopic(data.topic);
      return data.topic;
    } catch (err) {
      const errorMessage = err.message || "Неизвестная ошибка";
      setError(errorMessage);
      console.error("Ошибка:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return { generateTopic, isLoading, error, topic, setTopic };
}