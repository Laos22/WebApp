import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [isDriveConnected, setIsDriveConnected] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    const storedKey = localStorage.getItem('google_ai_api_key') || '';
    const storedDriveStatus = localStorage.getItem('google_drive_connected') === 'true';
    setApiKey(storedKey);
    setIsDriveConnected(storedDriveStatus);
  }, []);

  const handleSaveSettings = (e) => {
    e.preventDefault();
    localStorage.setItem('google_ai_api_key', apiKey.trim());
    localStorage.setItem('google_drive_connected', isDriveConnected);
    
    setSavedMessage('Настройки успешно сохранены!');
    setTimeout(() => setSavedMessage(''), 3000);
  };

  const handleToggleDrive = () => {
    const newStatus = !isDriveConnected;
    setIsDriveConnected(newStatus);
    localStorage.setItem('google_drive_connected', newStatus);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <Link to="/" className="text-sm text-purple-400 hover:text-purple-300 transition-colors mb-2 inline-block">
              &larr; На главную
            </Link>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">
              Настройки пользователя ⚙️
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Управляйте вашими API-ключами, интеграциями и персональными предпочтениями.
            </p>
          </div>
        </div>

        {savedMessage && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm">
            {savedMessage}
          </div>
        )}

        <form onSubmit={handleSaveSettings} className="bg-slate-900/80 border border-purple-500/20 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-md space-y-6">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-300">
              Google AI Studio API Key
            </label>
            <p className="text-xs text-slate-400">
              Ваш ключ хранится исключительно в вашем браузере (`localStorage`).
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-all font-mono text-sm"
            />
          </div>

          <hr className="border-slate-800" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">📁 Интеграция с Google Drive</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Автоматическое сохранение сгенерированного контента.
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleDrive}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isDriveConnected
                    ? 'bg-emerald-600/20 border border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-800 border border-slate-700 text-slate-300'
                }`}
              >
                {isDriveConnected ? '✓ Подключено' : 'Подключить Drive'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg transition-all"
          >
            Сохранить настройки
          </button>
        </form>
      </div>
    </div>
  );
}