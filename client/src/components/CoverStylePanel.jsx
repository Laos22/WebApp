import ProfileSelector from './ProfileSelector';
import { coverStyleUrl, coverTemplateUrl } from '../services/coverApi';

export default function CoverStylePanel({ projectId, style, busy, profile, setProfile, instruction, setInstruction, upload, analyze, confirm }) {
  const pending = style?.analysis && style.revision !== style.confirmed?.revision;
  const template = pending ? style.analysis.template : style?.confirmed?.template;
  const fonts = { condensed: 'узкий акцентный', sans: 'без засечек', serif: 'с засечками' };
  return <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4">
    <h2 className="text-lg font-semibold">1. Общий шаблон</h2>
    {template ? <>
      <p className={`text-sm ${pending ? 'text-amber-300' : 'text-emerald-300'}`}>{pending ? 'Предпросмотр · ожидает подтверждения' : 'Сохранённый шаблон · применяется ко всем проектам'}</p>
      <img src={coverTemplateUrl(projectId, pending ? style.revision : style.confirmed.revision, pending)} alt="Нейтральный образец оформления заголовка и подзаголовка" className="w-full rounded-xl bg-slate-950" />
      <p className="text-xs text-slate-400">Схема размещения текста. Сюжет и фон будут созданы по теме каждого проекта.</p>
      <p className="text-sm text-slate-300">{template.designNotes}</p>
      <div className="text-xs text-slate-400 space-y-1">{[['title', 'Заголовок'], ['subtitle', 'Подзаголовок']].map(([key, name]) => <p key={key}>{name}: {fonts[template[key].font]}, до {template[key].fontSize}px, цвет <span style={{color: template[key].color}}>{template[key].color}</span></p>)}</div>
    </> : <p className="text-sm text-slate-400">Загрузите пример. ИИ опишет его и выделит оформление без исходного сюжета. Проверьте и примените шаблон.</p>}
    {style && <details open={!style.confirmed} className="text-sm text-slate-300"><summary className="cursor-pointer">Исходный пример и анализ</summary><img src={coverStyleUrl(projectId, style.revision)} alt="Исходный пример для анализа оформления" className="mt-3 w-full max-h-40 rounded-xl object-contain bg-slate-950" />{style.analysis && <p className="mt-3 whitespace-pre-wrap">{style.analysis.observation}</p>}<p className="mt-2 text-xs text-slate-500">Исходная картинка используется только при анализе. В генерацию обложки отправляется нейтральный макет.</p></details>}
    <details className="text-sm text-slate-400"><summary className="cursor-pointer">Профиль анализа · Google Studio</summary><div className="mt-3"><ProfileSelector type="text" provider="google_studio" value={profile} onChange={setProfile} projectId={projectId} operation="cover-analysis" disabled={!!busy} /></div></details>
    <label className="block text-sm text-purple-200">{busy === 'style' ? 'Загружаем и анализируем…' : style ? 'Заменить пример и проанализировать' : 'Загрузить и проанализировать'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy} onChange={upload} className="mt-2 block w-full text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-white" /></label>
    {style && !style.analysis && <button disabled={!!busy} onClick={analyze} className="text-sm text-purple-300 underline">{busy === 'analysis' ? 'Анализируем…' : 'Проанализировать сохранённый пример'}</button>}
    {style?.analysis && <>
      <label className="block text-sm text-slate-300">Что изменить в шаблоне?<textarea rows={3} value={instruction} maxLength={4000} disabled={!!busy} onChange={e => setInstruction(e.target.value)} placeholder="Например: текст сверху слева, крупнее; белый подзаголовок под ним. Фон сделать светлее." className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label>
      <div className="flex flex-wrap gap-3"><button disabled={!!busy || !instruction.trim()} onClick={analyze} className="rounded-xl bg-slate-700 px-4 py-2 text-sm disabled:opacity-50">{busy === 'analysis' ? 'Вносим правки…' : 'Уточнить шаблон'}</button>{pending && <button disabled={!!busy} onClick={confirm} className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'confirm' ? 'Сохраняем…' : 'Применить и сохранить шаблон'}</button>}</div>
    </>}
    {style?.confirmed && style.confirmed.revision !== style.revision && <p className="text-xs text-amber-300">До подтверждения изменений используется предыдущий сохранённый шаблон.</p>}
  </section>;
}
