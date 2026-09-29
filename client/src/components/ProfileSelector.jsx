import { useEffect, useMemo, useState } from "react";
import { fetchProfiles } from "../services/profileService";

const typeLabels = { text: "Текст", image: "Изображение", audio: "Звук" };

export default function ProfileSelector({ type = "text", value = "", onChange, disabled = false, projectId = "", operation = "default" }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const storageKey = projectId ? `ai-profile:${projectId}:${operation}` : "";
  useEffect(() => {
    let active = true;
    fetchProfiles().then(items => {
      if (!active) return;
      const compatible = items.filter(item => item.type === type);
      setProfiles(compatible);
      if (!value) {
        let saved = "";
        try { saved = storageKey ? localStorage.getItem(storageKey) || "" : ""; } catch { /* optional */ }
        const selected = compatible.some(item => item.id === saved) ? saved : "";
        onChange(selected);
      }
    }).catch(() => { if (active) setProfiles([]); }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [type, storageKey]);
  const selected = useMemo(() => profiles.find(item => item.id === value), [profiles, value]);
  const change = event => {
    const next = event.target.value;
    try { if (storageKey) next ? localStorage.setItem(storageKey, next) : localStorage.removeItem(storageKey); } catch { /* optional */ }
    onChange(next);
  };
  return <label className="block">
    <span className="block text-sm text-slate-300 mb-2">Профиль генерации · {typeLabels[type] || type}</span>
    <select value={value} onChange={change} disabled={disabled || loading} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3">
      <option value="">Автоматически — профиль по умолчанию</option>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.isDefault ? " — по умолчанию" : ""}{profile.provider ? ` · ${profile.provider}` : ""}</option>)}
    </select>
    {!loading && !profiles.length && <span className="block mt-1 text-xs text-amber-300">Нет доступных профилей типа «{typeLabels[type] || type}».</span>}
    {selected && <span className="block mt-1 text-xs text-slate-400">Выбран для этой операции: {selected.name}</span>}
  </label>;
}
