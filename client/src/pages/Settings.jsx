
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(''); // Новое состояние
  const [model, setModel] = useState('gpt-4o'); // Выбор модели
  const [isDriveConnected, setIsDriveConnected] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    setApiKey(localStorage.getItem('google_ai_api_key') || '');
    setSystemPrompt(localStorage.getItem('ai_system_prompt') || 'Ты — профессиональный YouTube-сценарист. Твоя задача — создавать виральные сценарии, которые удерживают внимание зрителя.');
    setIsDriveConnected(localStorage.getItem('google_drive_connected') === 'true');
  }, []);

  const handleSaveSettings = (e) => {
    e.preventDefault();
    localStorage.setItem('google_ai_api_key', apiKey.trim());
    localStorage.setItem('ai_system_prompt', systemPrompt);
    localStorage.setItem('google_drive_connected', isDriveConnected);
    
    setSavedMessage('Настройки успешно сохранены!');
    setTimeout(() => setSavedMessage(''), 3000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* ... (заголовок такой же) */}
        
        <form onSubmit={handleSaveSettings} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 md:p-8 space-y-8">
          
          {/* Блок: AI Engine */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-white border-b border-slate-800 pb-2">AI Engine</h2>
            <div>
              <label className="block text-sm text-slate-400 mb-2">API Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3" />
            </div>
          </section>

          {/* Блок: System Prompt */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-white border-b border-slate-800 pb-2">Системный промпт</h2>
            <p className="text-xs text-slate-400">Это глобальная установка для ИИ. Каждая генерация будет учитывать эту роль.</p>
            <textarea 
              value={systemPrompt} 
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full h-32 bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm"
            />
          </section>

          {/* Блок: Интеграции */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-white border-b border-slate-800 pb-2">Интеграции</h2>
            <div className="flex items-center justify-between">
              <span>Google Drive</span>
              <button type="button" onClick={() => setIsDriveConnected(!isDriveConnected)} className={`px-4 py-2 rounded-lg ${isDriveConnected ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                {isDriveConnected ? 'Подключено' : 'Подключить'}
              </button>
            </div>
          </section>

          <button type="submit" className="w-full py-4 bg-purple-600 rounded-xl font-bold hover:bg-purple-500">Сохранить</button>
        </form>
      </div>
    </div>
  );
}