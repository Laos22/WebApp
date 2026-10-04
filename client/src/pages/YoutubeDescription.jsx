import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProfileSelector from '../components/ProfileSelector';
import { getYoutubeDescription, generateYoutubeDescription, saveYoutubeDescription } from '../services/api';

const inputClass = 'w-full rounded-xl border border-slate-700 bg-slate-950 p-4 text-slate-100 focus:border-purple-500 focus:outline-none';
const buttonClass = 'rounded-xl px-4 py-3 font-semibold disabled:opacity-40 disabled:cursor-not-allowed';
function cacheDraft(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The editor still works when local storage is unavailable. */ }
}

export default function YoutubeDescription() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const draftKey = `youtube-description:${user?._id || user?.id || 'current'}:${projectId}`;
  const [loadedKey, setLoadedKey] = useState('');
  const [project, setProject] = useState(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [instruction, setInstruction] = useState('');
  const [profileId, setProfileId] = useState('');
  const [generatedFor, setGeneratedFor] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [reload, setReload] = useState(0);
  const loading = loadedKey !== draftKey;
  const dirty = content !== savedContent;

  useEffect(() => {
    let active = true;
    setLoadedKey(''); setError(''); setMessage(''); setWarnings([]);
    getYoutubeDescription(projectId).then(data => {
      if (!active) return;
      let draft;
      try { draft = JSON.parse(localStorage.getItem(draftKey)); } catch { /* Start with the saved file. */ }
      const canRestore = draft?.baseContent === data.content && typeof draft.content === 'string';
      setProject(data); setSavedContent(data.content);
      setContent(canRestore ? draft.content : data.content);
      setInstruction(canRestore && typeof draft.instruction === 'string' ? draft.instruction : '');
      setGeneratedFor(canRestore ? draft.generatedFor || '' : '');
      if (canRestore && draft.content !== data.content) setMessage('Восстановлен черновик. Нажмите «Сохранить», чтобы записать его в папку проекта.');
      setLoadedKey(draftKey);
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [projectId, draftKey, reload]);

  useEffect(() => {
    if (!loading) cacheDraft(draftKey, { content, instruction, baseContent: savedContent, generatedFor });
  }, [draftKey, content, instruction, savedContent, generatedFor, loading]);

  const generate = async (edit = false) => {
    setBusy(edit ? 'edit' : 'generate'); setError(''); setMessage(''); setWarnings([]);
    try {
      const result = await generateYoutubeDescription(projectId, {
        instruction, content: edit ? content : '', profileId,
      });
      cacheDraft(draftKey, { content: result.content, instruction, baseContent: savedContent, generatedFor: result.sourceFingerprint });
      setContent(result.content); setGeneratedFor(result.sourceFingerprint);
      setProject(previous => ({ ...previous, timeline: result.timeline, sourceFingerprint: result.sourceFingerprint }));
      setWarnings(result.warnings || []);
      setMessage(edit ? 'Правки внесены. Проверьте текст и сохраните.' : 'Описание готово. Проверьте текст и сохраните.');
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('save'); setError(''); setMessage('');
    try {
      const result = await saveYoutubeDescription(projectId, content);
      setContent(result.content); setSavedContent(result.content);
      setMessage(`Сохранено в папке проекта: ${result.filename}`);
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); setMessage('Описание скопировано.'); }
    catch { setError('Не удалось скопировать автоматически. Выделите текст в редакторе и скопируйте его.'); }
  };

  return <div className="min-h-screen bg-slate-950 px-3 py-6 text-left text-white sm:px-6 md:py-10">
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <Link to={`/projects/${projectId}`} className="text-sm text-purple-400 hover:text-purple-300">← К проекту</Link>
        <h1 className="mt-3 !text-3xl font-bold sm:!text-4xl">Описание для YouTube</h1>
        <p className="mt-2 text-slate-400">{project?.projectTitle || 'Сценарий, главы и таймкоды в одном описании.'}</p>
      </header>
      {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-red-200">{error}{loading && <button onClick={() => setReload(value => value + 1)} className="ml-3 underline">Повторить загрузку</button>}</div>}
      {message && <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3 text-sm text-emerald-200">{message}</p>}
      {loading ? !error && <p className="py-10 text-slate-400">Загрузка описания…</p> : <>
        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="!text-xl font-semibold">Подготовка описания</h2>
            <Link to="/settings" className="text-sm text-purple-300 hover:underline">Настройки → Промты → Описание для YouTube</Link>
          </div>
          <ProfileSelector type="text" value={profileId} onChange={setProfileId} disabled={Boolean(busy)} projectId={projectId} operation="youtube-description" />
          <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
            <p className={project.timeline.ready ? 'text-emerald-300' : 'text-amber-200'}>{project.timeline.ready ? `✓ Таймлайн доступен · ${project.timeline.chapters.length} возможных начал глав` : 'Таймлайн пока не готов'}</p>
            <p className="mt-1 text-slate-400">{project.timeline.message}</p>
            {project.timeline.ready && <details className="mt-2"><summary className="cursor-pointer text-purple-300">Посмотреть таймкоды</summary><ul className="mt-2 max-h-48 space-y-1 overflow-auto">{project.timeline.chapters.map(chapter => <li key={chapter.blockId}><span className="mr-2 font-mono text-slate-200">{chapter.timestamp}</span>{chapter.title}</li>)}</ul></details>}
          </div>
          {!project.hasScript && <p className="text-sm text-amber-200">Для генерации <Link to={`/projects/${projectId}/script`} className="underline">создайте и сохраните сценарий</Link>. Ввести описание вручную можно уже сейчас.</p>}
          <label className="block text-sm text-slate-300" htmlFor="description-instruction">Инструкции для генерации или редактирования</label>
          <textarea id="description-instruction" className={`${inputClass} min-h-28 resize-y`} rows={3} maxLength={4000} disabled={Boolean(busy)} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="Например: сократи вступление, добавь интригу, оставь 5 глав и напиши на украинском." />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button onClick={() => generate(false)} disabled={Boolean(busy) || !project.hasScript} className={`${buttonClass} bg-purple-700 hover:bg-purple-600`}>{busy === 'generate' ? 'Генерируем описание…' : content.trim() ? 'Сгенерировать заново' : 'Сгенерировать описание'}</button>
            <button onClick={() => generate(true)} disabled={Boolean(busy) || !project.hasScript || !content.trim() || !instruction.trim() || content.length > 5000} className={`${buttonClass} bg-slate-800 hover:bg-slate-700`}>{busy === 'edit' ? 'Вносим правки…' : 'Применить инструкции'}</button>
          </div>
        </section>
        {warnings.map(warning => <p key={warning} className="rounded-xl bg-amber-950/30 p-3 text-sm text-amber-200">{warning}</p>)}
        {generatedFor && generatedFor !== project.sourceFingerprint && <p className="text-sm text-amber-200">Сценарий или таймлайн изменился после генерации этого черновика. Обновите описание перед сохранением.</p>}
        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 sm:px-6">
            <label htmlFor="youtube-description" className="text-xl font-semibold">Текст описания</label>
            <span className={`text-sm ${dirty ? 'text-amber-200' : 'text-slate-400'}`}>{dirty ? 'Есть несохранённые изменения' : savedContent ? 'Сохранено в проекте' : 'Новый черновик'}</span>
          </div>
          <div className="px-3 sm:px-6"><textarea id="youtube-description" value={content} onChange={event => { setContent(event.target.value); setMessage(''); }} disabled={Boolean(busy)} className={`${inputClass} min-h-[50vh] resize-y leading-relaxed`} style={{ height: '60vh' }} placeholder="Здесь появится готовое описание. Его можно отредактировать вручную." /></div>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="text-sm text-slate-400"><p className={content.length > 5000 ? 'text-red-300' : ''}>{content.length} / 5000 символов</p><p className="mt-1">Файл: youtube_description.txt в папке проекта</p></div>
            <div className="flex flex-wrap gap-2">
              <button onClick={copy} disabled={!content.trim()} className={`${buttonClass} bg-slate-800 hover:bg-slate-700`}>Копировать</button>
              <button onClick={save} disabled={Boolean(busy) || !content.trim() || content.length > 5000 || !dirty} className={`${buttonClass} bg-purple-700 hover:bg-purple-600`}>{busy === 'save' ? 'Сохраняем…' : 'Сохранить'}</button>
            </div>
          </div>
        </section>
      </>}
    </div>
  </div>;
}
