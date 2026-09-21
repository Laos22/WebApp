import { useEffect, useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getVideoPlan, saveVideoPlanFrame, videoPreviewUrl, videoPlanAction, saveVideoInstructions } from '../services/api';

import { pendingVideoFrames, runVideoQueue } from '../services/videoPlanQueue';

const button = 'rounded-xl bg-purple-700 px-4 py-3 text-white disabled:opacity-40';
export default function VideoPlan() {
  const { projectId } = useParams();
  const stop = useRef(false);
  const [instructions, setInstructions] = useState('');
  const [progress, setProgress] = useState('');
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
    getVideoPlan(projectId).then(result => { if (active) { setData(result); setInstructions(result.videoPlan.instructions); } })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; stop.current = true; };
  }, [projectId, reload]);
  const frame = data?.frames[index];
  const saved = data?.videoPlan.frames.find(item => item.frameId === frame?.frameId);
  const draft = frame && (drafts[frame.frameId] || saved);
  const dirty = draft && (draft.selected !== saved.selected || draft.videoPrompt !== saved.videoPrompt);
  useEffect(() => {
    if (!Object.keys(drafts).length && instructions === data?.videoPlan.instructions && !busy) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts, instructions, data, busy]);
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
  const unsaved = Object.keys(drafts).length > 0 || (data && instructions !== data.videoPlan.instructions);
  async function operation(action, mode) {
    if (action === 'reset' && !window.confirm('Сбросить статус промтов выбранных кадров и подготовить их заново?')) return;
    setBusy(true); stop.current = false; setError(''); setMessage(''); setProgress('');
    let current = data;
    const accept = result => { current = result; setData(result); };
    const request = (kind, extra = {}) => videoPlanAction(projectId, kind,
      { expectedEditVersion: current.videoPlan.editVersion, ...extra });
    try {
      if (action === 'instructions') {
        accept(await saveVideoInstructions(projectId, instructions, current.videoPlan.editVersion));
        setInstructions(current.videoPlan.instructions);
      } else if (action === 'confirm') accept(await request('confirm'));
      else {
        if (action === 'reset') accept(await request('reset'));
        const analyzing = action === 'analyze';
        const items = analyzing ? current.analysisChunks.map((_, i) => i)
          : mode === 'single' ? [frame.frameId] : pendingVideoFrames(current.videoPlan, action !== 'all');
        setProgress(`0 / ${items.length}`);
        await runVideoQueue({ items, stopped: () => stop.current, onResult: accept, onProgress: setProgress,
          request: item => request(analyzing ? 'analyze' : 'prepare', analyzing ? { chunkIndex: item } : { frameId: item }) });
      }
      setMessage(stop.current ? 'Остановлено. Готовые результаты сохранены.' : 'Готово. Результаты сохранены.');
    } catch (err) { setError(err.message || 'Не удалось выполнить запрос. Повторите позже.'); setConflict(err.status === 409); }
    finally { setBusy(false); }
  }
  const readyCount = data?.videoPlan.frames.filter(f => f.selected && f.promptStatus === 'ready' && f.videoPrompt.trim()).length || 0;
  const selectedCount = data?.videoPlan.frames.filter(f => f.selected).length || 0;
  return <div className="mx-auto max-w-5xl p-4 sm:p-8 text-slate-200 space-y-6">
    <Link onClick={event => { if ((unsaved || busy) && !window.confirm("Есть несохранённые правки или выполняется запрос. Покинуть страницу?")) event.preventDefault(); }} className="text-purple-300" to={`/projects/${projectId}`}>← К проекту</Link>
    <h1 className="text-2xl sm:text-3xl font-bold">Работа с видео</h1>
    {data && <p className="break-words">{data.projectTitle}</p>}
    <p className="text-sm text-slate-400">Подготовьте промт и выберите кадры для видео. Генерация видео появится позже.</p>
    {error && <div role="alert" className="text-red-300 space-y-2"><p>{error}</p>
      {!data && <button className={button} onClick={() => setReload(value => value + 1)}>Повторить загрузку</button>}
      {conflict && <button className={button} disabled={busy} onClick={refreshConflict}>Обновить данные, сохранив мои правки</button>}
    </div>}
    {message && <p role="status" className="text-green-300">{message}</p>}
    {!data && !error && <p role="status">Загрузка…</p>}
    {data && <>
      <div className="sticky top-0 z-10 rounded-xl bg-slate-900 p-3 shadow-lg" role="status">
        {({ empty: 'Пустой план', draft: 'Черновик', confirmed: 'Утверждён', stale: 'Устарел' })[data.videoPlan.status]} · Готово {readyCount} / {selectedCount}
        {progress && <p>{progress}</p>}
        {busy && <button className={button} onClick={() => { stop.current = true; }}>Остановить после текущего запроса</button>}
      </div>
      <label className="block">Общие инструкции
        <textarea value={instructions} maxLength={4000} disabled={busy} onChange={e => setInstructions(e.target.value)}
          placeholder="Используй медленные движения камеры. Не анимируй архивные фотографии."
          className="mt-2 w-full rounded-xl bg-slate-900 p-3" />
      </label>
      <button className={button} disabled={busy || conflict || instructions === data.videoPlan.instructions}
        onClick={() => operation('instructions')}>Сохранить инструкции</button>
      <button className={button} disabled={busy || instructions === data.videoPlan.instructions}
        onClick={() => setInstructions(data.videoPlan.instructions)}>Отменить правки инструкций</button>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy || unsaved || conflict} onClick={() => operation('analyze')}>Анализировать кадры</button>
        <button className={button} disabled={busy || unsaved || conflict || !selectedCount} onClick={() => operation('all')}>Подготовить все промты</button>
        <button className={button} disabled={busy || unsaved || conflict || readyCount === selectedCount} onClick={() => operation('continue')}>Продолжить подготовку</button>
      </div>
      <details><summary className="cursor-pointer py-2">Дополнительные действия</summary>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy || unsaved || conflict || !selectedCount} onClick={() => operation('reset')}>Начать заново</button>
          <button className={button} disabled={busy || unsaved || conflict || !selectedCount || readyCount !== selectedCount || data.videoPlan.status === 'stale'}
            onClick={() => operation('confirm')}>Утвердить видеоплан</button>
        </div>
      </details>
      {unsaved && <p className="text-amber-300">Сохраните или отмените правки перед запуском ИИ.</p>}
    </>}
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
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={busy || !drafts[frame.frameId]} onClick={() => setDrafts(previous => {
              const next = { ...previous }; delete next[frame.frameId]; return next;
            })}>Отменить правки кадра</button>
            {saved.selected && <button className={button} disabled={busy || unsaved || conflict || !frame.hasImage}
              onClick={() => operation('prepare', 'single')}>{saved.promptStatus === 'ready' ? 'Перегенерировать prompt' : 'Подготовить prompt'}</button>}
          </div>
          <p className="text-sm text-slate-400">Промт: {saved.promptStatus === 'ready' ? 'готов' : 'ожидает подготовки'}</p>
          {dirty && <p className="text-sm text-amber-300">Есть несохранённые изменения. При переключении кадров они остаются на этой странице.</p>}
        </div>
      </div>
    </>}
  </div>;
}
