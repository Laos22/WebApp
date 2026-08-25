import React, { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";

const AuthContext = createContext(null);

// Базовый URL бэкенда из переменных окружения или fallback на localhost:5001
const API_URL = import.meta.env.VITE_SERVER_URL;
console.log("🔗 API_URL:", API_URL);
// Настраиваем axios для передачи куки (сессий)
axios.defaults.withCredentials = true;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    // Режим разработки: обходим проверку на сервере
    if (import.meta.env.VITE_BYPASS_AUTH === "true") {
      setUser({
        _id: "dev-user-id",
        email: "dev@local.host",
        name: "Developer",
      });
      setLoading(false);
      return;
    }
    try {
      const response = await axios.get(`${API_URL}/auth/status`);
      if (response.data.authenticated) {
        setUser(response.data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      // Если бэкенд выключен, логируем мягкое предупреждение вместо страшной ошибки сетевого сбоя
      if (error.code === "ERR_NETWORK") {
        console.warn(
          "⚠️ Бэкенд сервер недоступен. Проверьте, запущен ли сервер на порту 5001.",
        );
      } else {
        console.error("Ошибка проверки авторизации:", error);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = () => {
    window.location.href = `${API_URL}/auth/google`;
  };

  const logout = async () => {
    try {
      await axios.post(`${API_URL}/auth/logout`);
      setUser(null);
      setTimeout(() => {
        window.location.href = "/";
      }, 500);
    } catch (error) {
      console.error("Ошибка выхода:", error);
      setUser(null);
      window.location.href = "/";
    }
  };
  return (
    <AuthContext.Provider value={{ user, login, logout, loading, checkAuth }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
