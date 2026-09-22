import { useEffect, useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getVideoPlan, saveVideoPlanFrame, videoPreviewUrl, videoPlanAction, saveVideoInstructions } from '../services/api';
import { pendingVideoFrames, runVideoQueue } from '../services/videoPlanQueue';
import { videoPlanView } from '../services/videoPlanView';

const button = 'rounded-xl bg-purple-700 px-4 py-3 text-white disabled:opacity-40';
const secondary = 'rounded-xl border border-slate-600 px-4 py-3 text-slate-200 disabled:opacity-40';
export default function VideoPlan() {
  const { projectId } = useParams();
  return <VideoPlanEditor key={projectId} projectId={projectId} />;
}
function VideoPlanEditor({ projectId }) {
  const stop = useRef(false);
  const pickerToggle = useRef(null);
  const [instructions, setInstructions] = useState('');
  const [progress, setProgress] = useState('');
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    getVideoPlan(projectId).then(result => { if (active) { setData(result); setInstructions(result.videoPlan.instructions); } })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; stop.current = true; };
  }, [projectId, reload]);
  const view = videoPlanView(data, drafts);
  const frame = view.frames[index];
  const saved = data?.videoPlan.frames.find(item => item.frameId === frame?.frameId);
  const draft = frame?.plan;
  const frameEdits = Object.keys(drafts).length > 0;
  const instructionsDirty = data && instructions !== data.videoPlan.instructions;
  const unsaved = frameEdits || instructionsDirty;
  const dirty = draft && (draft.selected !== saved.selected || draft.videoPrompt !== saved.videoPrompt);
  const pendingCount = data ? pendingVideoFrames(data.videoPlan).length : 0;
  useEffect(() => {
    if (!unsaved && !busy) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved, busy]);
  function edit(patch) {
    const nextDraft = { ...draft, ...patch };
    setDrafts(previous => {
      const next = { ...previous };
      if (nextDraft.selected === saved.selected && nextDraft.videoPrompt === saved.videoPrompt) delete next[frame.frameId];
      else next[frame.frameId] = nextDraft;
      return next;
    });
    setMessage('');
  }
  function cancelFrame() {
    setDrafts(previous => { const next = { ...previous }; delete next[frame.frameId]; return next; });
  }
  async function persistFrame(current, frameId) {
    const value = drafts[frameId];
    if (!value) return current;
    const result = await saveVideoPlanFrame(projectId, {
      frameId, selected: value.selected, videoPrompt: value.videoPrompt,
      // A manually written initial prompt is a draft, not finished AI detailing.
      promptStatus: value.promptStatus === 'ready' ? 'ready' : 'pending',
    }, current.videoPlan.editVersion);
    setData(result);
    setDrafts(previous => { const next = { ...previous }; delete next[frameId]; return next; });
    return result;
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try { await persistFrame(data, frame.frameId); setMessage('Кадр сохранён.'); }
    catch (err) { setError(err.message); setConflict(err.status === 409); }
    finally { setBusy(false); }
  }
  async function refreshConflict() {
    setBusy(true); setError('');
    try {
      const result = await getVideoPlan(projectId);
      setData(result); setIndex(0); setConflict(false);
      if (!instructionsDirty) setInstructions(result.videoPlan.instructions);
      setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => result.frames.some(f => f.frameId === id))));
      setMessage('Данные обновлены. Проверьте локальные правки перед повторным сохранением.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function operation(action, mode) {
    if (action === 'reset' && !window.confirm('Заново детализировать все выбранные кадры?')) return;
    setBusy(true); setRunning(!['instructions', 'confirm'].includes(action));
    stop.current = false; setError(''); setMessage(''); setProgress('');
    let current = data;
    const accept = result => { current = result; setData(result); };
    const request = (kind, extra = {}) => videoPlanAction(projectId, kind,
      { expectedEditVersion: current.videoPlan.editVersion, ...extra });
    try {
      // Always send the instructions currently visible to the user.
      if (instructions !== current.videoPlan.instructions) {
        accept(await saveVideoInstructions(projectId, instructions, current.videoPlan.editVersion));
        setInstructions(current.videoPlan.instructions);
      }
      if (mode === 'single') accept(await persistFrame(current, frame.frameId));
      if (action === 'confirm') accept(await request('confirm'));
      else if (action !== 'instructions') {
        const analyzing = action === 'analyze' || action === 'resume-analysis';
        if (action === 'analyze') {
          setProgress('Анализ: читаем общие инструкции…');
          await runVideoQueue({ items: ['start'], stopped: () => stop.current, onResult: accept,
            onProgress: value => { if (!/^\d/.test(value)) setProgress(value); }, request: () => request('analyze-start') });
        }
        if (action === 'reset' && !stop.current) accept(await request('reset'));
        const completedChunks = current.videoPlan.analysis?.completedChunks || [];
        const items = analyzing ? current.analysisChunks.map((_, i) => i).filter(i => !completedChunks.includes(i))
          : mode === 'single' ? [frame.frameId] : pendingVideoFrames(current.videoPlan, action !== 'all');
        const updateProgress = value => {
          if (analyzing) {
            const ids = new Set((current.videoPlan.analysis?.completedChunks || []).flatMap(i => current.analysisChunks[i]?.frameIds || []));
            setProgress(/^\d/.test(value) ? `Анализ: проверено ${ids.size} из ${current.frames.length} кадров` : value);
          } else setProgress(/^\d/.test(value) ? `Детализация: обработано ${value} кадров` : value);
        };
        updateProgress('0');
        await runVideoQueue({ items, stopped: () => stop.current, onResult: accept, onProgress: updateProgress,
          request: item => request(analyzing ? 'analyze' : 'prepare', analyzing ? { chunkIndex: item } : { frameId: item }) });
      }
      setMessage(stop.current ? 'Остановлено. Результаты сохранены; можно продолжить.'
        : action === 'analyze' || action === 'resume-analysis' ? 'Анализ завершён. Проверьте выбор кадров и переходите к детализации.'
          : 'Готово. Результаты сохранены.');
    } catch (err) { setError(err.message || 'Не удалось выполнить запрос. Повторите позже.'); setConflict(err.status === 409); }
    finally { setBusy(false); setRunning(false); setProgress(''); }
  }
  function chooseFrame(i) { setIndex(i); setPickerOpen(false); setMessage(''); pickerToggle.current?.focus(); }
  const analysis = data?.videoPlan.analysis;
  const canResumeAnalysis = analysis && data.videoPlan.status !== 'stale' && analysis.completedChunks.length < data.analysisChunks.length;
  return <div className="mx-auto max-w-5xl p-4 sm:p-8 text-left text-slate-200 space-y-5">
    <Link onClick={event => { if ((unsaved || busy) && !window.confirm('Есть несохранённые правки или выполняется запрос. Покинуть страницу?')) event.preventDefault(); }}
      className="text-purple-300" to={`/projects/${projectId}`}>← К проекту</Link>
    <h1 className="text-2xl sm:text-3xl font-bold">Работа с видео</h1>
    {data && <p className="break-words text-slate-400">{data.projectTitle}</p>}
    {data && <div className="sticky top-0 z-10 rounded-xl bg-slate-900 p-3 sm:p-4 shadow-lg space-y-3" role="status">
      <div className="grid grid-cols-3 gap-2 sm:gap-5">
        {[[view.total, 'Всего кадров'], [view.selected, 'Выбрано для анимации'], [view.ready, 'Готово к генерации']].map(([count, label]) =>
          <div key={label}><div className="text-xl sm:text-2xl font-bold">{count}</div><div className="text-xs sm:text-sm text-slate-300">{label}</div></div>)}
      </div>
      <div className="text-xs text-slate-400">{({ empty: 'Выберите кадры для анимации', draft: 'Черновик видеоплана', confirmed: 'Видеоплан утверждён', stale: 'Раскадровка изменилась — проверьте план' })[data.videoPlan.status]}</div>
      {progress && <p>{progress}</p>}
      {running && <button className={secondary} onClick={() => { stop.current = true; setProgress('Остановка после текущего запроса…'); }}>Остановить после текущего запроса</button>}
    </div>}
    {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-200 space-y-2"><p>{error}</p>
      {!data && <button className={button} onClick={() => { setError(''); setReload(value => value + 1); }}>Повторить загрузку</button>}
      {conflict && <button className={button} disabled={busy} onClick={refreshConflict}>Обновить данные, сохранив мои правки</button>}
    </div>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
    {!data && !error && <p role="status">Загрузка…</p>}
    {data && <section className="rounded-2xl border border-slate-800 p-4 space-y-3" aria-labelledby="selection-heading">
      <h2 id="selection-heading" className="text-xl font-semibold">1. Выбор кадров</h2>
      <p className="text-sm text-slate-400">Попросите ИИ предложить кадры или выберите их вручную. Количество в инструкции относится ко всему проекту.</p>
      <label className="block">Общие инструкции
        <textarea value={instructions} maxLength={4000} disabled={busy} onChange={e => setInstructions(e.target.value)}
          placeholder="Выбери только 5 кадров для анимации. Используй медленные движения камеры. Не анимируй архивные фотографии."
          className="mt-2 min-h-24 w-full rounded-xl bg-slate-900 p-3" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy || frameEdits || conflict || !view.total} onClick={() => operation('analyze')}>Анализировать и предложить кадры</button>
        {canResumeAnalysis && <button className={secondary} disabled={busy || unsaved || conflict} onClick={() => operation('resume-analysis')}>Продолжить анализ</button>}
        {instructionsDirty && <>
          <button className={secondary} disabled={busy || conflict} onClick={() => operation('instructions')}>Сохранить инструкции</button>
          <button className={secondary} disabled={busy} onClick={() => setInstructions(data.videoPlan.instructions)}>Отменить правки инструкций</button>
        </>}
      </div>
      <p className="text-xs text-slate-400">Инструкции сохраняются при запуске ИИ. Повторный анализ пересматривает выбор кадров; во время анализа выбор предварительный.</p>
      {analysis?.selectionLimit != null && <p className="text-sm text-emerald-300">Лимит анализа: не более {analysis.selectionLimit} кадров на весь проект. Ручной выбор можно изменить.</p>}
    </section>}
    {frameEdits && <p className="text-amber-300 text-sm">Есть несохранённые правки кадров ({Object.keys(drafts).length}). Сохраните или отмените их перед анализом или массовой детализацией.</p>}
    {data && !frame && <p>В раскадровке пока нет кадров.</p>}
    {frame && <>
      <nav aria-label="Выбор кадра" className="grid grid-cols-2 gap-2 items-center sm:flex">
        <button className={secondary} disabled={busy || index === 0} onClick={() => setIndex(index - 1)}>← Предыдущий</button>
        <button ref={pickerToggle} className={`${secondary} col-span-2 row-start-1 min-w-0 sm:flex-1`} disabled={busy}
          aria-expanded={pickerOpen} aria-controls="video-frame-picker" onClick={() => setPickerOpen(value => !value)}>
          Кадр {index + 1} из {view.total} · Все кадры {pickerOpen ? '▴' : '▾'}
        </button>
        <button className={secondary} disabled={busy || index === view.total - 1} onClick={() => setIndex(index + 1)}>Следующий →</button>
      </nav>
      {pickerOpen && <section id="video-frame-picker" aria-label="Все кадры" className="rounded-xl border border-slate-700 p-3 space-y-3"
        onKeyDown={event => { if (event.key === 'Escape') { setPickerOpen(false); pickerToggle.current?.focus(); } }}>
        <p className="text-sm text-slate-300">Зелёным отмечены кадры для анимации. Выберите кадр, чтобы изменить галочку или промт.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto p-1">
          {view.frames.map((item, i) => <button key={item.frameId} disabled={busy} onClick={() => chooseFrame(i)} aria-current={i === index ? 'true' : undefined}
            className={`rounded-xl border-2 text-left overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 ${item.plan.selected ? 'border-emerald-400 bg-emerald-950/60' : 'border-slate-700 bg-slate-900'} ${i === index ? 'ring-2 ring-purple-400 ring-offset-2 ring-offset-slate-950' : ''}`}>
            {item.hasImage ? <img loading="lazy" src={videoPreviewUrl(item.previewUrl)} alt="" className="aspect-video w-full object-cover" />
              : <div className="aspect-video grid place-items-center text-xs text-slate-500">Нет изображения</div>}
            <div className="p-2 space-y-1">
              <p className="font-semibold">Кадр {i + 1}{item.unsaved ? ' *' : ''}</p>
              <p className="text-xs text-slate-400">Блок {item.blockNumber ?? '—'} · Кадр {item.frameInBlock}</p>
              <p className={`text-xs ${item.plan.selected ? 'text-emerald-300' : 'text-slate-400'}`}>{item.plan.selected ? '✓ Для анимации' : 'Статичный'}</p>
              {item.ready && <p className="text-xs text-emerald-200">Промт готов</p>}
            </div>
          </button>)}
        </div>
      </section>}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3 min-w-0">
          <h2 className="font-semibold">Кадр {index + 1} · Блок {frame.blockNumber ?? '—'}</h2>
          {frame.hasImage ? <img key={frame.previewUrl} src={videoPreviewUrl(frame.previewUrl)} alt={`Исходное изображение кадра ${index + 1}`}
            className="w-full max-h-[55vh] object-contain rounded-xl bg-slate-900" />
            : <div className="rounded-xl bg-slate-900 p-10 text-slate-400">Исходное изображение отсутствует или устарело.</div>}
          <label className="flex gap-3 items-center rounded-xl border border-slate-700 p-3"><input type="checkbox" checked={draft.selected} disabled={busy}
            onChange={event => edit({ selected: event.target.checked })} className="size-5 accent-emerald-500" />Анимировать этот кадр</label>
          <p className="whitespace-pre-wrap break-words text-sm">{frame.text}</p>
          <p className="text-sm text-slate-400">Длительность: {frame.targetDurationSec === null ? 'недоступна — проверьте раскадровку и озвучку' : `${frame.targetDurationSec.toFixed(2)} с${frame.durationExact ? '' : ' (оценка)'}`}</p>
          {frame.video && <p>Видео: {({ pending: 'ожидает', generating: 'создаётся', ready: 'готово', stale: 'устарело', error: 'ошибка' })[frame.video.status]}</p>}
        </div>
        <section className="space-y-3 min-w-0 rounded-2xl border border-slate-800 p-4" aria-labelledby="detail-heading">
          <h2 id="detail-heading" className="text-xl font-semibold">2. Детализация промта</h2>
          <p className="text-sm text-slate-400">Напишите идею движения или используйте черновик ИИ. Детализация подготовит английский промт для видео.</p>
          <label className="block text-sm" htmlFor="videoPrompt">{draft.promptStatus === 'ready' ? 'Детализированный промт' : 'Черновой промт движения'}</label>
          <textarea id="videoPrompt" value={draft.videoPrompt} maxLength={12000} disabled={busy}
            placeholder="Например: камера медленно приближается к поезду, туман плавно движется."
            onChange={event => edit({ videoPrompt: event.target.value })}
            className="w-full min-h-52 rounded-xl border border-slate-700 bg-slate-900 p-3 resize-y" />
          <div className="flex flex-wrap gap-2">
            <button className={secondary} disabled={busy || !dirty || conflict} onClick={save}>Сохранить кадр</button>
            {drafts[frame.frameId] && <button className={secondary} disabled={busy} onClick={cancelFrame}>Отменить правки кадра</button>}
          </div>
          <button className={`${button} w-full`} disabled={busy || !draft.selected || conflict || !frame.hasImage}
            onClick={() => operation('prepare', 'single')}>{saved.promptStatus === 'ready' ? 'Детализировать промт заново' : 'Детализировать промт кадра'}</button>
          {!draft.selected && <p className="text-xs text-slate-400">Отметьте «Анимировать этот кадр», чтобы детализировать его промт.</p>}
          <p className="text-xs text-slate-400">Правки текущего кадра сохраняются перед детализацией. Готово к генерации = выбранный кадр с готовым промтом и актуальным изображением.</p>
          <div className="border-t border-slate-700 pt-3 space-y-2">
            <button className={`${button} w-full`} disabled={busy || frameEdits || conflict || !view.selected} onClick={() => operation('all')}>Детализировать все выбранные ({view.selected})</button>
            {pendingCount > 0 && pendingCount < view.selected && <button className={`${secondary} w-full`} disabled={busy || frameEdits || conflict}
              onClick={() => operation('continue')}>Продолжить детализацию ({pendingCount})</button>}
          </div>
        </section>
      </div>
    </>}
    {data && <details><summary className="cursor-pointer py-2 text-slate-400">Дополнительные действия</summary>
      <div className="flex flex-wrap gap-2 pt-2">
        <button className={secondary} disabled={busy || unsaved || conflict || !view.selected} onClick={() => operation('reset')}>Начать детализацию заново</button>
        <button className={secondary} disabled={busy || unsaved || conflict || !view.selected || view.ready !== view.selected}
          onClick={() => operation('confirm')}>Утвердить видеоплан</button>
      </div>
    </details>}
    <p className="text-xs text-slate-500">Здесь подготавливается видеоплан. Генерация видео будет доступна позже.</p>
  </div>;
}
