import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Header from "./components/Header";
import Login from "./pages/Login";
import Home from "./pages/Home";
import ProjectWorkspace from "./pages/ProjectWorkspace";
import ImageGen from "./pages/ImageGen";
import AudioGen from "./pages/AudioGen";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-slate-950 font-sans selection:bg-purple-500 selection:text-white flex flex-col">
          <Header />
          <main className="flex-1">
            <Routes>
              {/* Публичная страница входа */}
              <Route path="/login" element={<Login />} />

              {/* Защищенные роуты */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Home />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/projects/:projectId"
                element={
                  <ProtectedRoute>
                    <ProjectWorkspace />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/projects/:projectId/image"
                element={
                  <ProtectedRoute>
                    <ImageGen />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/projects/:projectId/audio"
                element={
                  <ProtectedRoute>
                    <AudioGen />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                }
              />

              {/* Редирект для несуществующих путей */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </Router>
    </AuthProvider>
  );
}
