import { Pencil, Trash2, Star } from "lucide-react";
import { TYPE_LABELS, PROVIDER_LABELS } from "../utils/aiProfileConstants";

/**
 * Презентационная карточка AI-профиля.
 * Никакой бизнес-логики: только отображение и проброс действий наверх.
 *
 * @param {object}   props
 * @param {object}   props.profile   — профиль (id, name, type, provider, isDefault)
 * @param {Function} props.onEdit    — (profile) => void
 * @param {Function} props.onDelete  — (id) => void
 */
export default function ProfileCard({ profile, onEdit, onDelete }) {
  const { id, name, type, provider, isDefault } = profile;

  return (
    <div className="group relative flex items-center justify-between gap-4 bg-slate-950 border border-slate-800 hover:border-purple-500/50 rounded-xl p-4 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-white truncate">{name}</h3>
          {isDefault && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 rounded-full">
              <Star size={12} className="fill-amber-400" />
              По умолчанию
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-400 truncate">
          {TYPE_LABELS[type] ?? type} · {PROVIDER_LABELS[provider] ?? provider}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onEdit(profile)}
          className="p-2 text-slate-400 hover:text-purple-300 hover:bg-slate-800 rounded-lg transition-colors"
          aria-label={`Редактировать профиль ${name}`}
        >
          <Pencil size={18} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(id)}
          className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
          aria-label={`Удалить профиль ${name}`}
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}
