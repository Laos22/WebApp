import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Search, X } from "lucide-react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useProfiles } from "../hooks/useProfiles";
import ProfileCard from "../components/ProfileCard";
import ProfileFormModal from "../components/ProfileFormModal";
import { getEmptyProfile, PROVIDER_LABELS, PROFILE_TYPES } from "../utils/aiProfileConstants";

const SERVER_URL = String(import.meta.env.VITE_SERVER_URL || "").replace(/\/$/, "");
const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || (import.meta.env.VITE_BYPASS_AUTH === "true" ? "developer" : "google");
axios.defaults.withCredentials = true;

const PROMPTS = [
  { key: "theme", title: "Генерация темы", description: "Системная роль и правила для создания темы проекта." },
  { key: "script", title: "Генерация сценария", description: "Системная роль для написания сценария." },
  { key: "audio", title: "Адаптация текста для озвучки", description: "Подготовка текста для ElevenLabs с сохранением блоков." },
  { key: "visualBiblePrompt", title: "Генерация Visual Bible", description: "Правила создания единого визуального стиля." },
  { key: "visualBibleEditPrompt", title: "Редактирование Visual Bible", description: "Инструкции для изменения Visual Bible." },
  { key: "visualReferencePrompt", title: "Визуальные референсы", description: "Базовые правила подготовки промтов референсов." },
  { key: "referenceAnalysisPrompt", title: "Анализ референсов", description: "Выбор героев, локаций и предметов из сценария." },
  { key: "referenceDetailPrompt", title: "Детализация референса", description: "Подробный промт для одного референса." },
  { key: "storyboardPrompt", title: "Генерация раскадровки", description: "Разделение озвучки на кадры и подбор референсов." },
  { key: "storyboardDetailPrompt", title: "Детализация кадра", description: "Подробный промт для одного кадра." },
  { key: "videoPlanAnalysisPrompt", title: "Анализ кадров для видео", description: "План движения и длительности видео." },
  { key: "videoPromptPreparationPrompt", title: "Подготовка промта движения", description: "Английский промт для видеогенерации." },
  { key: "cover", title: "Генерация обложки", description: "Общие правила заголовков и готовой обложки с текстом. Применяются в Google Studio и пакете Google Flow вместе с сохранённым примером." },
  { key: "timelineDavinci", title: "Экспорт таймлайна", description: "Правила подготовки материалов для DaVinci Resolve." },
  { key: "youtubeDescription", title: "Описание для YouTube", description: "Стиль описания, язык, главы и хештеги. Сценарий и таймлайн добавляются автоматически." },
];
const emptyPrompts = Object.fromEntries(PROMPTS.map(({ key }) => [key, ""]));

export default function Settings() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("profiles");
  const [prompts, setPrompts] = useState(emptyPrompts);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [driveConnected, setDriveConnected] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [profileType, setProfileType] = useState("all");
  const [profileProvider, setProfileProvider] = useState("all");
  const [profileSearch, setProfileSearch] = useState("");
  const { profiles, isLoading: profilesLoading, error: profilesError, saveProfile, removeProfile } = useProfiles(Boolean(user));
  const [editingProfile, setEditingProfile] = useState(null);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await axios.get(`${SERVER_URL}/api/settings`);
      setPrompts(Object.fromEntries(PROMPTS.map(({ key }) => [key, response.data.prompts?.[key] ?? ""])));
      setDriveConnected(Boolean(response.data.driveConnected));
    } catch { setSavedMessage("✗ Ошибка загрузки настроек"); }
    finally { setIsLoading(false); }
  }, []);
  useEffect(() => { if (user) fetchSettings(); }, [user, fetchSettings]);

  const showMessage = message => { setSavedMessage(message); window.setTimeout(() => setSavedMessage(""), 3000); };
  const handleSaveSettings = async event => {
    event?.preventDefault(); setIsSaving(true);
    try { const response = await axios.post(`${SERVER_URL}/api/settings`, { prompts }); if (response.status === 200) showMessage("✓ Промты сохранены"); }
    catch { showMessage("✗ Ошибка при сохранении промтов"); } finally { setIsSaving(false); }
  };
  const filteredProfiles = useMemo(() => profiles.filter(profile => {
    const matchesType = profileType === "all" || profile.type === profileType;
    const matchesProvider = profileProvider === "all" || profile.provider === profileProvider;
    const matchesSearch = !profileSearch.trim() || profile.name.toLowerCase().includes(profileSearch.trim().toLowerCase());
    return matchesType && matchesProvider && matchesSearch;
  }), [profiles, profileType, profileProvider, profileSearch]);
  const providerOptions = useMemo(() => [...new Set(profiles.filter(profile => profileType === "all" || profile.type === profileType).map(profile => profile.provider))], [profiles, profileType]);
  const handleSaveProfile = async profile => { try { await saveProfile(profile); setEditingProfile(null); showMessage("✓ Профиль сохранён"); } catch (error) { showMessage(`✗ ${error.message}`); } };
  const handleDeleteProfile = async id => { if (!window.confirm("Удалить этот профиль? Действие необратимо.")) return; try { await removeProfile(id); showMessage("✓ Профиль удалён"); } catch (error) { showMessage(`✗ ${error.message}`); } };

  if (!user) return <div className="min-h-screen bg-slate-950 text-white p-6 flex items-center justify-center"><div className="text-center"><p className="text-slate-400 mb-4">Требуется авторизация.</p><Link to="/" className="text-purple-400 hover:text-purple-300">Вернуться на главную</Link></div></div>;
  if (isLoading) return <div className="min-h-screen bg-slate-950 text-white p-6 flex items-center justify-center"><p className="text-slate-400">Загрузка настроек...</p></div>;

  return <div className="min-h-screen bg-slate-950 text-white px-3 py-5 sm:p-6 md:p-10">
    <div className="max-w-5xl mx-auto space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3"><div><Link to="/" className="text-sm text-purple-400 hover:text-purple-300">&larr; На главную</Link><h1 className="mt-2 text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">Настройки</h1></div>{savedMessage && <div className={`px-3 py-2 rounded-xl border text-sm ${savedMessage.includes("✓") ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>{savedMessage}</div>}</header>
      <nav className="grid grid-cols-2 p-1 rounded-2xl bg-slate-900 border border-slate-800" aria-label="Разделы настроек">{[["profiles", "Профили"], ["prompts", "Промты"]].map(([tab, label]) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`py-2.5 rounded-xl text-sm sm:text-base font-semibold transition-colors ${activeTab === tab ? "bg-purple-700 text-white" : "text-slate-400 hover:text-white"}`}>{label}</button>)}</nav>

      {activeTab === "profiles" ? <section className="space-y-5">
        <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h2 className="text-xl font-bold">AI-профили</h2><p className="text-sm text-slate-400 mt-1">Ключи шифруются на сервере. Используйте фильтры, чтобы быстро найти нужный профиль.</p></div><button type="button" onClick={() => setEditingProfile(getEmptyProfile())} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-700 hover:bg-purple-600 rounded-xl font-semibold"><Plus size={18} />Добавить</button></div><div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-5"><label className="relative"><Search size={16} className="absolute left-3 top-3 text-slate-500" /><input value={profileSearch} onChange={event => setProfileSearch(event.target.value)} placeholder="Поиск по названию" className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm" /></label><select value={profileType} onChange={event => { setProfileType(event.target.value); setProfileProvider("all"); }} className="bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm"><option value="all">Все типы</option>{PROFILE_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select><select value={profileProvider} onChange={event => setProfileProvider(event.target.value)} className="bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm"><option value="all">Все провайдеры</option>{providerOptions.map(provider => <option key={provider} value={provider}>{PROVIDER_LABELS[provider] || provider}</option>)}</select></div></section>
        {profilesError && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">{profilesError}</div>}
        {profilesLoading ? <p className="text-sm text-slate-400">Загрузка профилей...</p> : filteredProfiles.length ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{filteredProfiles.map(profile => <ProfileCard key={profile.id} profile={profile} onEdit={setEditingProfile} onDelete={handleDeleteProfile} />)}</div> : <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center text-slate-500">{profiles.length ? "По выбранным фильтрам профили не найдены." : "Пока нет профилей. Создайте первый профиль."}</div>}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-6"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h2 className="font-bold">Google Drive</h2><p className={`text-sm mt-1 ${driveConnected ? "text-emerald-400" : "text-amber-300"}`}>{driveConnected ? "Подключён. Файлы новых проектов могут сохраняться в Drive." : AUTH_MODE === "developer" ? "В режиме Developer используется локальное хранилище." : "Не подключён. Переподключите Google-аккаунт и разрешите доступ."}</p></div>{AUTH_MODE === "google" && <a href={`${SERVER_URL}/auth/google`} className="inline-flex justify-center px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold">{driveConnected ? "Переподключить Drive" : "Подключить Drive"}</a>}</div></section>
      </section> : <form onSubmit={handleSaveSettings} className="space-y-4">
        <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Системные промты</h2><p className="text-sm text-slate-400 mt-1">Выберите нужный шаблон. Полный текст откроется в редакторе.</p></div><button type="submit" disabled={isSaving} className="px-4 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-600 disabled:opacity-50 font-semibold">{isSaving ? "Сохранение…" : "Сохранить промты"}</button></div></section>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{PROMPTS.map(prompt => <button key={prompt.key} type="button" onClick={() => setEditingPrompt(prompt.key)} className="text-left bg-slate-900/80 border border-slate-800 hover:border-purple-500/60 rounded-2xl p-4 transition-colors"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-white">{prompt.title}</h3><p className="text-xs text-slate-400 mt-1">{prompt.description}</p></div><Pencil size={16} className="shrink-0 text-purple-300" /></div><p className="mt-3 text-xs text-slate-500 line-clamp-2 whitespace-pre-wrap">{prompts[prompt.key] || "Используется стандартный шаблон"}</p></button>)}</div>
      </form>}
    </div>
    {editingProfile && <ProfileFormModal key={editingProfile.id ?? "new"} initialProfile={editingProfile} onSave={handleSaveProfile} onClose={() => setEditingProfile(null)} />}
    {editingPrompt && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4"><section role="dialog" aria-modal="true" className="w-full max-w-6xl h-[96dvh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl"><header className="shrink-0 flex items-center justify-between gap-3 p-4 sm:p-5 border-b border-slate-800"><div><h2 className="font-bold text-lg">{PROMPTS.find(prompt => prompt.key === editingPrompt)?.title}</h2><p className="text-xs text-slate-400 mt-1">Изменения применятся после сохранения промтов.</p></div><button type="button" onClick={() => setEditingPrompt(null)} className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700" aria-label="Закрыть"><X size={20} /></button></header><div className="flex-1 min-h-0 p-3 sm:p-5"><textarea autoFocus value={prompts[editingPrompt] || ""} onChange={event => setPrompts(prev => ({ ...prev, [editingPrompt]: event.target.value }))} className="w-full h-full bg-slate-950 border border-slate-700 rounded-xl p-3 sm:p-4 text-sm leading-6 resize-none" /></div><footer className="shrink-0 flex flex-col-reverse sm:flex-row justify-end gap-2 p-3 sm:p-5 border-t border-slate-800"><button type="button" onClick={() => setEditingPrompt(null)} className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700">Закрыть</button><button type="button" onClick={() => setEditingPrompt(null)} className="px-4 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-600">Готово</button></footer></section></div>}
  </div>;
}
