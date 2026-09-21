import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getVideoPlan, saveVideoPlanFrame, videoPreviewUrl } from '../services/api';

const button = 'rounded-xl bg-purple-700 px-4 py-3 text-white disabled:opacity-40';
export default function VideoPlan() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null); setDrafts({}); setIndex(0); setError(''); setConflict(false); setMessage('');
    getVideoPlan(projectId).then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [projectId, reload]);
  const frame = data?.frames[index];
  const saved = data?.videoPlan.frames.find(item => item.frameId === frame?.frameId);
  const draft = frame && (drafts[frame.frameId] || saved);
  const dirty = draft && (draft.selected !== saved.selected || draft.videoPrompt !== saved.videoPrompt);
  useEffect(() => {
    if (!Object.keys(drafts).length) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);
  function edit(patch) {
    setDrafts(previous => ({ ...previous, [frame.frameId]: { ...draft, ...patch } }));
    setMessage('');
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveVideoPlanFrame(projectId, {
        frameId: frame.frameId, selected: draft.selected, videoPrompt: draft.videoPrompt,
      }, data.videoPlan.editVersion);
      setData(result);
      setDrafts(previous => { const next = { ...previous }; delete next[frame.frameId]; return next; });
      setMessage('Кадр сохранён.');
    } catch (err) { setError(err.message); setConflict(err.status === 409); }
    finally { setBusy(false); }
  }
  async function refreshConflict() {
    setBusy(true); setError('');
    try {
      const result = await getVideoPlan(projectId);
      setData(result); setIndex(0); setConflict(false);
      setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => result.frames.some(frame => frame.frameId === id))));
      setMessage('Данные обновлены. Ваши правки сохранены локально: проверьте кадр перед повторным сохранением.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-5xl p-4 sm:p-8 text-slate-200 space-y-6">
    <Link className="text-purple-300" to={`/projects/${projectId}`}>← К проекту</Link>
    <h1 className="text-2xl sm:text-3xl font-bold">Работа с видео</h1>
    {data && <p className="break-words">{data.projectTitle}</p>}
    <p className="text-sm text-slate-400">Подготовьте промт и выберите кадры для видео. Генерация видео появится позже.</p>
    {error && <div role="alert" className="text-red-300 space-y-2"><p>{error}</p>
      {!data && <button className={button} onClick={() => setReload(value => value + 1)}>Повторить загрузку</button>}
      {conflict && <button className={button} disabled={busy} onClick={refreshConflict}>Обновить данные, сохранив мои правки</button>}
    </div>}
    {message && <p role="status" className="text-green-300">{message}</p>}
    {!data && !error && <p role="status">Загрузка…</p>}
    {data?.videoPlan.status === 'stale' && <p className="text-amber-300">Раскадровка изменилась. Проверьте промты кадров.</p>}
    {data && !frame && <p>В раскадровке пока нет кадров.</p>}
    {frame && <>
      <nav aria-label="Выбор кадра" className="flex flex-wrap gap-3 items-center">
        <button className={button} disabled={busy || index === 0} onClick={() => { setIndex(index - 1); setMessage(''); }}>← Предыдущий</button>
        <select aria-label="Кадр" className="min-w-0 flex-1 w-full rounded-xl bg-slate-800 p-3" disabled={busy} value={index}
          onChange={event => { setIndex(Number(event.target.value)); setMessage(''); }}>
          {data.frames.map((item, i) => <option key={item.frameId} value={i}>Блок {item.blockNumber ?? '—'} · Кадр {item.frameInBlock}{drafts[item.frameId] ? ' *' : ''}</option>)}
        </select>
        <button className={button} disabled={busy || index === data.frames.length - 1} onClick={() => { setIndex(index + 1); setMessage(''); }}>Следующий →</button>
      </nav>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 min-w-0">
          {frame.hasImage ? <img key={frame.previewUrl} src={videoPreviewUrl(frame.previewUrl)} alt={`Исходное изображение кадра ${index + 1}`}
            className="w-full max-h-[55vh] object-contain rounded-xl bg-slate-900" />
            : <div className="rounded-xl bg-slate-900 p-10 text-slate-400">Исходное изображение отсутствует или устарело.</div>}
          <p className="whitespace-pre-wrap break-words">{frame.text}</p>
          <p>Целевая длительность: {frame.targetDurationSec === null ? 'недоступна — проверьте раскадровку и озвучку' : `${frame.targetDurationSec.toFixed(2)} с${frame.durationExact ? '' : ' (оценка по тексту)'}`}</p>
          {frame.video && <p>Видео: {({ pending: 'ожидает', generating: 'создаётся', ready: 'готово', stale: 'устарело', error: 'ошибка' })[frame.video.status]}</p>}
        </div>
        <div className="space-y-4 min-w-0">
          <label className="flex gap-3 items-center py-3"><input type="checkbox" checked={draft.selected} disabled={busy}
            onChange={event => edit({ selected: event.target.checked })} className="size-5" />Создавать видео для этого кадра</label>
          <label className="block" htmlFor="videoPrompt">Видеопромт</label>
          <textarea id="videoPrompt" value={draft.videoPrompt} maxLength={12000} disabled={busy}
            onChange={event => edit({ videoPrompt: event.target.value })}
            className="w-full min-h-64 rounded-xl border border-slate-700 bg-slate-900 p-4 resize-y" />
          <button className={`${button} w-full`} disabled={busy || !dirty || conflict} onClick={save}>{busy ? 'Сохранение…' : 'Сохранить кадр'}</button>
          {dirty && <p className="text-sm text-amber-300">Есть несохранённые изменения. При переключении кадров они остаются на этой странице.</p>}
        </div>
      </div>
    </>}
  </div>;
}
