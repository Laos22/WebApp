import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getVideoPlan, videoPreviewUrl, getShorts, suggestShorts, createShort, saveShort, deleteShort,
  generateShortAudio, exportShortXml, shortAudioUrl } from '../services/api';
import { normalizeMediaRoot } from '../../../shared/davinciMediaPaths.js';

const field = 'w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white';
const button = 'rounded-xl px-4 py-2.5 font-medium disabled:cursor-not-allowed disabled:opacity-50';
const draftOf = short => ({ title: short.title, hook: short.hook || '', narration: short.narration,
  shots: short.shots.map(shot => ({ frameId: shot.frameId, horizontalOffset: shot.horizontalOffset || 0,
    durationWeight: shot.durationWeight || 1 })) });

export default function Shorts() {
  const { projectId } = useParams();
  const [shorts, setShorts] = useState([]);
  const [frames, setFrames] = useState([]);
  const [storyboardRevision, setStoryboardRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pathMode, setPathMode] = useState('absolute');
  const [mediaRootPath, setMediaRootPath] = useState(() => {
    try { return localStorage.getItem(`davinci-media-root:${projectId}`) || ''; } catch { return ''; }
  });
  const [includeMusic, setIncludeMusic] = useState(true);
  const [musicVolume, setMusicVolume] = useState(0.3);
  const [frameRate, setFrameRate] = useState(24);

  useEffect(() => {
    let active = true;
    Promise.all([getShorts(projectId), getVideoPlan(projectId)])
      .then(([saved, source]) => {
        if (!active) return;
        setShorts(saved.shorts || []);
        setStoryboardRevision(saved.storyboardRevision || 0);
        setFrames(source.frames || []);
        const first = saved.shorts?.[0];
        if (first) { setSelectedId(first.id); setDraft(draftOf(first)); }
      })
      .catch(cause => active && setError(cause.message))
      .finally(() => active && setBusy(''));
    return () => { active = false; };
  }, [projectId]);

  const selected = shorts.find(short => short.id === selectedId);
  const frameById = useMemo(() => new Map(frames.map(frame => [frame.frameId, frame])), [frames]);
  const readyFrames = frames.filter(frame => frame.hasImage);
  const dirty = Boolean(selected && draft && JSON.stringify(draft) !== JSON.stringify(draftOf(selected)));
  const audioReady = selected?.audio?.status === 'ready';
  const approximateSeconds = draft ? Math.round([...draft.narration].length / 15) : 0;

  const choose = short => { setSelectedId(short.id); setDraft(draftOf(short)); setError(''); setMessage(''); };
  const replaceShort = short => { setShorts(current => current.map(item => item.id === short.id ? short : item)); setDraft(draftOf(short)); };
  const run = async (name, action) => {
    if (busy) return;
    setBusy(name); setError(''); setMessage('');
    try { await action(); } catch (cause) { setError(cause.message); } finally { setBusy(''); }
  };
  const create = proposal => run('create', async () => {
    const result = await createShort(projectId, proposal);
    setShorts(current => [result.short, ...current]); choose(result.short); setSuggestions([]);
    setMessage('Шортс создан. Проверьте текст и порядок кадров.');
  });
  const createManual = () => {
    if (!readyFrames.length) { setError('Сначала подготовьте изображения для кадров.'); return; }
    const shots = readyFrames.slice(0, 6).map(frame => ({ frameId: frame.frameId, horizontalOffset: 0, durationWeight: 1 }));
    create({ title: 'Новый шортс', hook: '', narration: (readyFrames[0].text || 'Текст шортса').slice(0, 3000), shots });
  };
  const save = () => run('save', async () => {
    const result = await saveShort(projectId, selected.id, { ...draft, version: selected.version });
    replaceShort(result.short); setMessage('Изменения сохранены.');
  });
  const audio = () => run('audio', async () => {
    const result = await generateShortAudio(projectId, selected.id);
    replaceShort(result.short); setMessage('Озвучка готова. Прослушайте её перед экспортом.');
  });
  const exportXml = () => run('export', async () => {
    const result = await exportShortXml(projectId, selected.id, { pathMode,
      mediaRootPath: pathMode === 'relative' || !mediaRootPath.trim() ? '' : normalizeMediaRoot(mediaRootPath),
      includeMusic, backgroundMusicVolume: musicVolume, frameRate });
    if (pathMode === 'absolute') {
      try { localStorage.setItem(`davinci-media-root:${projectId}`, result.mediaRootPath); } catch { /* Optional preference. */ }
    }
    setMessage(`Готов ${result.filename} · ${result.durationSec.toFixed(1)} сек. · MP4: ${result.videosUsed}. XML сохранён в папке проекта.`);
  });
  const remove = () => {
    if (!window.confirm('Удалить этот шортс и его отдельную озвучку?')) return;
    run('delete', async () => {
      await deleteShort(projectId, selected.id);
      const remaining = shorts.filter(short => short.id !== selected.id);
      setShorts(remaining); setSelectedId(remaining[0]?.id || ''); setDraft(remaining[0] ? draftOf(remaining[0]) : null);
    });
  };
  const changeShot = (index, patch) => setDraft(current => ({ ...current,
    shots: current.shots.map((shot, position) => position === index ? { ...shot, ...patch } : shot) }));
  const moveShot = (index, delta) => setDraft(current => {
    const shots = [...current.shots];
    [shots[index], shots[index + delta]] = [shots[index + delta], shots[index]];
    return { ...current, shots };
  });

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-950 p-4 text-white md:p-10">
    <main className="mx-auto max-w-6xl space-y-6">
      <header>
        <Link to={`/projects/${projectId}`} className="text-fuchsia-400">&larr; К проекту</Link>
        <h1 className="mt-2 text-3xl font-extrabold">Шортсы · 9:16</h1>
        <p className="mt-2 text-slate-400">Отдельные короткие версии из кадров проекта с собственной озвучкой и вертикальным XML для DaVinci Resolve.</p>
      </header>
      {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-red-200">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4 text-emerald-200">{message}</div>}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-bold">Идеи и варианты</h2><p className="text-sm text-slate-400">ИИ предложит короткие истории по актуальной раскадровке. Можно начать вручную.</p></div>
          <div className="flex flex-wrap gap-2"><button disabled={Boolean(busy)} onClick={() => run('suggest', async () => {
            const result = await suggestShorts(projectId); setSuggestions(result.suggestions);
          })} className={`${button} bg-fuchsia-700 hover:bg-fuchsia-600`}>{busy === 'suggest' ? 'Анализ…' : 'Предложить шортсы'}</button>
            <button disabled={Boolean(busy)} onClick={createManual} className={`${button} bg-slate-700 hover:bg-slate-600`}>Создать вручную</button></div>
        </div>
        {suggestions.length > 0 && <div className="mt-5 grid gap-3 md:grid-cols-3">{suggestions.map((proposal, index) => <div key={index} className="space-y-3 rounded-xl border border-fuchsia-700/40 bg-slate-950 p-4">
          <h3 className="font-bold">{proposal.title}</h3><p className="text-sm text-fuchsia-200">{proposal.hook}</p>
          <p className="text-sm text-slate-300">{proposal.narration.slice(0, 240)}{proposal.narration.length > 240 ? '…' : ''}</p>
          <p className="text-xs text-slate-400">Кадров: {proposal.shots.length} · ≈ {Math.round([...proposal.narration].length / 15)} сек.</p>
          <button disabled={Boolean(busy)} onClick={() => create(proposal)} className={`${button} bg-fuchsia-700`}>Выбрать идею</button>
        </div>)}</div>}
        <div className="mt-5 flex flex-wrap gap-2">{shorts.map(short => <button key={short.id} onClick={() => choose(short)} disabled={Boolean(busy)}
          className={`${button} ${selectedId === short.id ? 'bg-fuchsia-700' : 'bg-slate-800 hover:bg-slate-700'}`}>{short.title}</button>)}</div>
        {!shorts.length && !busy && <p className="mt-4 text-slate-400">Шортсов пока нет.</p>}
      </section>

      {selected && draft && <>
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Сценарий шортса</h2>
            <button onClick={remove} disabled={Boolean(busy)} className="text-sm text-red-300 hover:text-red-200">Удалить вариант</button></div>
          {selected.sourceStoryboardRevision !== storyboardRevision && <p className="text-amber-300">Раскадровка изменилась после создания шортса. Проверьте выбранные кадры.</p>}
          <label className="block text-sm text-slate-300">Название<input value={draft.title} maxLength={120} onChange={event => setDraft({ ...draft, title: event.target.value })} className={`mt-1 ${field}`} /></label>
          <label className="block text-sm text-slate-300">Зацепка первых секунд<input value={draft.hook} maxLength={500} onChange={event => setDraft({ ...draft, hook: event.target.value })} className={`mt-1 ${field}`} /></label>
          <label className="block text-sm text-slate-300">Текст диктора<textarea value={draft.narration} maxLength={3000} rows={7} onChange={event => setDraft({ ...draft, narration: event.target.value })} className={`mt-1 ${field}`} /></label>
          <p className="text-sm text-slate-400">{[...draft.narration].length} символов · приблизительно {approximateSeconds} сек. Точная длительность появится после озвучки.</p>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div><h2 className="text-xl font-bold">Кадры и вертикальное кадрирование</h2>
            <p className="text-sm text-slate-400">Кадры идут в указанном порядке. Смещение задаёт положение изображения в вертикальном кадре; окончательную композицию проверьте в DaVinci.</p></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{draft.shots.map((shot, index) => {
            const frame = frameById.get(shot.frameId);
            const preview = frame?.previewUrl;
            return <div key={shot.frameId} className="rounded-xl border border-slate-700 bg-slate-950 p-3">
              <div className="mx-auto aspect-[9/16] max-h-64 w-36 overflow-hidden rounded-lg bg-slate-900">
                {preview ? <img src={videoPreviewUrl(preview)} alt={`Кадр ${frame.blockNumber}.${frame.frameInBlock}`} className="h-full w-full object-cover" style={{ objectPosition: `${50 - shot.horizontalOffset}% 50%` }} />
                  : <div className="flex h-full items-center justify-center text-sm text-amber-300">Нет изображения</div>}
              </div>
              <p className="mt-2 text-sm font-medium">{index + 1}. Кадр {frame ? `${frame.blockNumber}.${frame.frameInBlock}` : 'удалён'}</p>
              <p className="line-clamp-2 min-h-10 text-xs text-slate-400">{frame?.text || 'Кадр больше не найден в раскадровке.'}</p>
              <label className="mt-2 block text-xs text-slate-300">Положение<select value={shot.horizontalOffset} onChange={event => changeShot(index, { horizontalOffset: Number(event.target.value) })} className={`mt-1 ${field}`}>
                <option value={-30}>Левее</option><option value={0}>Центр</option><option value={30}>Правее</option></select></label>
              <label className="mt-2 block text-xs text-slate-300">Относительная длительность<select value={shot.durationWeight} onChange={event => changeShot(index, { durationWeight: Number(event.target.value) })} className={`mt-1 ${field}`}>
                {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
              <div className="mt-3 flex gap-2 text-sm"><button disabled={index === 0} onClick={() => moveShot(index, -1)} className="rounded bg-slate-800 px-2 disabled:opacity-30">↑</button>
                <button disabled={index === draft.shots.length - 1} onClick={() => moveShot(index, 1)} className="rounded bg-slate-800 px-2 disabled:opacity-30">↓</button>
                <button disabled={draft.shots.length === 1} onClick={() => setDraft(current => ({ ...current, shots: current.shots.filter((_, i) => i !== index) }))} className="ml-auto text-red-300 disabled:opacity-30">Убрать</button></div>
            </div>;
          })}</div>
          <label className="block max-w-xl text-sm text-slate-300">Добавить кадр из проекта<select value="" disabled={draft.shots.length >= 24} onChange={event => {
            if (event.target.value) setDraft(current => ({ ...current, shots: [...current.shots,
              { frameId: event.target.value, horizontalOffset: 0, durationWeight: 1 }] }));
          }} className={`mt-1 ${field}`}><option value="">Выберите готовое изображение</option>
            {readyFrames.filter(frame => !draft.shots.some(shot => shot.frameId === frame.frameId)).map(frame =>
              <option key={frame.frameId} value={frame.frameId}>Кадр {frame.blockNumber}.{frame.frameInBlock} — {frame.text?.slice(0, 90)}</option>)}</select></label>
          <button disabled={Boolean(busy) || (!dirty && selected.sourceStoryboardRevision === storyboardRevision) || !draft.title.trim() || !draft.narration.trim() || draft.shots.some(shot => !frameById.get(shot.frameId)?.hasImage)}
            onClick={save} className={`${button} bg-emerald-700 hover:bg-emerald-600`}>Сохранить шортс</button>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-xl font-bold">Озвучка и XML</h2>
          <p className="text-sm text-slate-400">Озвучка создаётся отдельно для шортса. Изменение текста потребует сгенерировать её заново.</p>
          <button disabled={Boolean(busy) || dirty} onClick={audio} className={`${button} bg-indigo-700 hover:bg-indigo-600`}>{busy === 'audio' ? 'Генерация…' : audioReady ? 'Перегенерировать озвучку' : 'Создать озвучку'}</button>
          {audioReady && <div><p className="mb-2 text-sm text-emerald-300">MP3 готов · {selected.audio.durationSec?.toFixed(1)} сек.</p>
            <audio controls src={shortAudioUrl(projectId, selected.id, selected.audio.generatedAt)} className="w-full" /></div>}
          {selected.audio?.status === 'stale' && <p className="text-amber-300">Текст изменился, прежняя озвучка устарела.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-300">FPS<select value={frameRate} onChange={event => setFrameRate(Number(event.target.value))} className={`mt-1 ${field}`}><option value={24}>24</option><option value={25}>25</option><option value={30}>30</option></select></label>
            <label className="text-sm text-slate-300">Пути к медиа<select value={pathMode} onChange={event => setPathMode(event.target.value)} className={`mt-1 ${field}`}><option value="absolute">Абсолютные</option><option value="relative">Относительные</option></select></label>
          </div>
          {pathMode === 'absolute' && <label className="block text-sm text-slate-300">Папка проекта на компьютере с Resolve<input value={mediaRootPath} onChange={event => setMediaRootPath(event.target.value)} placeholder="Пусто — локальная папка проекта" className={`mt-1 ${field}`} /></label>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeMusic} onChange={event => setIncludeMusic(event.target.checked)} />Добавить фоновую музыку проекта</label>
          {includeMusic && <label className="block text-sm text-slate-300">Громкость музыки: {musicVolume.toFixed(2)}<input type="range" min="0.01" max="1" step="0.01" value={musicVolume} onChange={event => setMusicVolume(Number(event.target.value))} className="mt-2 w-full accent-fuchsia-500" /></label>}
          <p className="text-xs text-slate-400">XML 1080×1920 будет сохранён рядом с основным XML. Для готовых MP4 используется видео; для остальных кадров — JPG с движением.</p>
          <button disabled={Boolean(busy) || dirty || !audioReady || !draft.shots.every(shot => frameById.get(shot.frameId)?.hasImage)}
            onClick={exportXml} className={`${button} bg-fuchsia-700 hover:bg-fuchsia-600`}>{busy === 'export' ? 'Подготовка XML…' : 'Создать вертикальный XML'}</button>
        </section>
      </>}
    </main>
  </div>;
}
