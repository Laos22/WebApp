import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { generateDavinciXml, getDavinciStatus } from "../services/api";
import { audioTrimSeconds, validateAudioTrim } from '../../../shared/davinciAudioTrim.js';
import { normalizeMediaRoot } from '../../../shared/davinciMediaPaths.js';

const button = "px-4 py-2.5 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed";

export default function DavinciExport() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [frameRate, setFrameRate] = useState(24);
  const [charsPerSecond, setCharsPerSecond] = useState(15);
  const [addAnimations, setAddAnimations] = useState(true);
  const [addTransitions, setAddTransitions] = useState(() => {
    try { return localStorage.getItem(`davinci-transitions:${projectId}`) !== 'false'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(`davinci-transitions:${projectId}`, String(addTransitions)); } catch { /* Optional preference storage. */ }
  }, [projectId, addTransitions]);
  const [transitionDurationSec, setTransitionDurationSec] = useState(0.5);
  const [audioTrim, setAudioTrim] = useState({ enabled: false, mode: 'phrase', phrase: '-Абзац-', startSec: 0, endSec: 0 });
  const updateTrim = (key, value) => setAudioTrim(current => ({ ...current, [key]: value }));
  const [pathMode, setPathMode] = useState('absolute');
  const [mediaRootPath, setMediaRootPath] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    getDavinciStatus(projectId)
      .then(result => {
        if (!active) return;
        setData(result);
        let savedRoot = '';
        try { savedRoot = localStorage.getItem(`davinci-media-root:${projectId}`) || ''; } catch { /* Storage may be disabled. */ }
        setMediaRootPath(savedRoot || result.defaultMediaRootPath || '');
      })
      .catch(err => active && setError(err.message))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [projectId]);

  const timings = (data?.audioTimings || []).map(item => ({ ...item,
    seconds: item.exact ? item.durationSec : item.textLength / charsPerSecond,
  }));
  const settingsValid = Number.isFinite(charsPerSecond) && charsPerSecond >= 5 && charsPerSecond <= 30 &&
    Number.isFinite(transitionDurationSec) && transitionDurationSec > 0 && transitionDurationSec <= 5;
  const structureValid = timings.length > 0 && timings.every(item => item.frameCount > 0 && item.seconds * frameRate >= item.frameCount);
  const totalSeconds = timings.reduce((sum, item) => sum + item.seconds, 0);
  let trimError = '';
  let trimPreviews = [];
  try {
    validateAudioTrim(audioTrim);
    trimPreviews = timings.map(item => audioTrimSeconds(item.trimText, item.seconds, audioTrim));
  } catch {
    trimError = 'Проверьте обрезку: фраза не должна быть пустой, сумма краёв должна быть меньше длительности каждого блока.';
  }

  let pathError = '';
  if (pathMode === 'absolute') {
    if (mediaRootPath) {
      try { normalizeMediaRoot(mediaRootPath); } catch { pathError = 'Нужен абсолютный путь к папке проекта на компьютере с Resolve.'; }
    } else if (data?.requiresMediaRoot) pathError = 'Укажите путь к папке проекта на компьютере с Resolve.';
  }

  const generate = async () => {
    if (busy || !data?.canExport || !settingsValid || !structureValid || trimError || pathError) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await generateDavinciXml(projectId, { frameRate, charsPerSecond, addAnimations, addTransitions, transitionDurationSec, audioTrim, pathMode,
        mediaRootPath: pathMode === 'relative' ? '' : mediaRootPath ? normalizeMediaRoot(mediaRootPath) : '' });
      if (pathMode === 'absolute') {
        setMediaRootPath(result.mediaRootPath);
        try { localStorage.setItem(`davinci-media-root:${projectId}`, result.mediaRootPath); } catch { /* Storage may be disabled. */ }
      }
      setMessage('Time Line готов');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white p-4 md:p-10">
    <main className="max-w-4xl mx-auto space-y-6">
      <header>
        <Link to={`/projects/${projectId}`} className="text-cyan-400 text-sm">&larr; Назад к проекту</Link>
        <h1 className="text-3xl font-extrabold mt-2">DaVinci Resolve 🎬</h1>
        <p className="text-slate-400 mt-2">Таймлайн из изображений, готовых видео, озвучки, музыки и эффектов.</p>
      </header>

      {error && <div role="alert" className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{error}</div>}
      {message && <div role="status" className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{message}</div>}

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 space-y-5">
        <div><h2 className="text-xl font-bold">Готовность проекта</h2><p className="text-sm text-slate-400">{data?.projectName || "Загрузка…"}</p></div>
        <div className="grid sm:grid-cols-4 gap-3">
          <div className="p-4 bg-slate-950 rounded-xl"><span className="text-xs text-slate-500">Раскадровка</span><p className={data?.storyboardReady ? "text-emerald-400" : "text-amber-300"}>{data?.storyboardReady ? "Актуальна" : "Требует обновления"}</p></div>
          <div className="p-4 bg-slate-950 rounded-xl"><span className="text-xs text-slate-500">Изображения</span><p>{data ? `${data.readyImages}/${data.frames}` : "—"}</p></div>
          <div className="p-4 bg-slate-950 rounded-xl"><span className="text-xs text-slate-500">Аудиоблоки</span><p>{data ? `${data.readyAudio}/${data.audioBlocks}` : "—"}</p></div>
          <div className="p-4 bg-slate-950 rounded-xl"><span className="text-xs text-slate-500">Фоновая музыка</span><p className={data?.backgroundMusicReady ? "text-emerald-400" : "text-slate-400"}>{data?.backgroundMusicReady ? "Будет добавлена" : "Не добавлена"}</p></div>
        </div>
        <p className="text-sm text-slate-400">Звуковых эффектов для экспорта: {data?.soundEffectCount ?? 0}. Готовые актуальные MP4 заменяют изображения соответствующих кадров.</p>
        {data && !data.canExport && <p className="text-amber-300">Для экспорта нужны актуальная утверждённая раскадровка, все изображения и MP3-блоки.</p>}
      </section>

      <section className="bg-slate-900 border border-cyan-800/40 rounded-2xl p-5 md:p-6 space-y-5">
        <h2 className="text-xl font-bold">Настройки таймлайна</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <label><span className="block text-sm text-slate-300 mb-2">Частота кадров</span><select value={frameRate} onChange={event => setFrameRate(Number(event.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3"><option value={24}>24 FPS</option><option value={25}>25 FPS</option><option value={30}>30 FPS</option></select></label>
          <label><span className="block text-sm text-slate-300 mb-2">Оценка скорости речи</span><input type="number" min="5" max="30" step="0.5" value={charsPerSecond} onChange={event => setCharsPerSecond(Number(event.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3" /><span className="block text-xs text-slate-500 mt-1">Символов в секунду, только при неизвестной длительности MP3</span></label>
        </div>
        <div className="space-y-3 border border-slate-700 rounded-xl p-4">
          <label className="block">Пути к медиа<select value={pathMode} onChange={event => { setPathMode(event.target.value); setError(""); }} className="block w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3"><option value="absolute">Абсолютные — для компьютера с Resolve</option><option value="relative">Относительные — переносимый проект</option></select></label>
          {pathMode === 'absolute' && <label className="block">Папка проекта на компьютере с Resolve<input value={mediaRootPath} onChange={event => { setMediaRootPath(event.target.value); setError(""); }} placeholder={data?.requiresMediaRoot ? '/Users/имя/Projects/Мой проект' : 'Автоматически: локальная папка проекта'} className="block w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3" /><span className="text-xs text-slate-400">Папка, внутри которой находятся images и audio. Для Google Drive укажите локальный путь на вашем компьютере. Поле меняет ссылки в XML, а не место сохранения проекта.</span></label>}
          {pathMode === 'relative' && <p className="text-sm text-amber-300">При импорте Resolve может потребовать вручную указать папку с медиа.</p>}
          {pathError && <p role="alert" className="text-amber-300">{pathError}</p>}
        </div>
        <label className="flex gap-3 items-center"><input type="checkbox" checked={addAnimations} onChange={event => setAddAnimations(event.target.checked)} />Анимации Zoom / Pan из настроек кадров</label>
        <label className="flex gap-3 items-center"><input type="checkbox" checked={addTransitions} onChange={event => setAddTransitions(event.target.checked)} />Переходы через чёрный на всех стыках, в начале и конце</label>
        <label className="block">Длительность перехода, сек.<input type="number" min="0.01" max="5" step="0.01" disabled={!addTransitions} value={transitionDurationSec} onChange={event => setTransitionDurationSec(Number(event.target.value))} className="block w-full mt-2 bg-slate-950 border border-slate-700 rounded-xl p-3 disabled:opacity-50" /><span className="text-xs text-slate-400">Округляется до чётного числа кадров; для коротких кадров сокращается или пропускается.</span></label>
        <div className="space-y-3 border border-slate-700 rounded-xl p-4">
          <label className="flex gap-3 items-center"><input type="checkbox" checked={audioTrim.enabled} onChange={event => updateTrim('enabled', event.target.checked)} />Подрезать аудио по краям без сдвига таймлайна</label>
          {audioTrim.enabled && <>
            <label className="block">Способ обрезки<select value={audioTrim.mode} onChange={event => updateTrim('mode', event.target.value)} className="block w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3"><option value="phrase">По числу символов слова или фразы — приблизительно</option><option value="seconds">По заданным секундам — для всех блоков</option></select></label>
            {audioTrim.mode === 'phrase' ? <label className="block">Слово или фраза для расчёта<input value={audioTrim.phrase} maxLength={200} onChange={event => updateTrim('phrase', event.target.value)} className="block w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3" /><span className="text-xs text-amber-300">Любой введённый текст задаёт число символов для обрезки с каждого края: {Array.from(audioTrim.phrase.trim()).length}. Совпадение с текстом озвучки не требуется. Время приблизительное: это не распознавание речи.</span></label>
              : <div className="grid sm:grid-cols-2 gap-3">{[['startSec', 'Убрать в начале, сек.'], ['endSec', 'Убрать в конце, сек.']].map(([key, label]) => <label key={key}>{label}<input type="number" min="0" max="60" step="0.01" value={audioTrim[key]} onChange={event => updateTrim(key, Number(event.target.value))} className="block w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>)}</div>}
            <p className="text-sm text-slate-400">Исходные MP3 не меняются. На месте обрезанных краёв останется тишина; изображения и следующие блоки сохранят свои позиции.</p>
          </>}
          {trimError && <p role="alert" className="text-amber-300">{trimError}</p>}
        </div>
        <div className="space-y-2 text-sm">
          {timings.map((item, index) => <p key={item.id}>Блок {item.order}: {item.available ? "MP3 готов" : "MP3 недоступен"} · {item.exact ? "Точная" : "Приблизительная"} длительность: {item.seconds.toFixed(3)} сек.{audioTrim.enabled && trimPreviews[index] && <span className="block text-slate-400">Обрезка: {trimPreviews[index].start.toFixed(3)} сек. в начале / {trimPreviews[index].end.toFixed(3)} сек. в конце; звучание: {(item.seconds - trimPreviews[index].start - trimPreviews[index].end).toFixed(3)} сек.</span>}</p>)}
          <p className="font-bold">Общая продолжительность: {totalSeconds.toFixed(3)} сек. {timings.some(item => !item.exact) ? "(приблизительно)" : ""}</p>
          {data?.warnings?.map((warning, index) => <p key={index} className="text-amber-300">{warning}</p>)}
          {!settingsValid && <p className="text-amber-300">Проверьте скорость речи (5–30) и длительность перехода (0,01–5 сек.).</p>}
          {data && !structureValid && <p className="text-amber-300">Каждому аудиоблоку нужны кадры и минимум один видеокадр времени на изображение.</p>}
        </div>
        <div className="p-4 rounded-xl bg-blue-950/30 border border-blue-800/40 text-sm text-blue-200 space-y-2">
          <p>XML сохраняется в корне проекта. Браузер не скачивает файл.</p>
          <p>Файлы still_… — экспортные копии для Resolve. Они предотвращают объединение кадров в последовательности. Повторная генерация использует те же файлы, пока изображения не изменились.</p>
          <p>Длительность определяется из MP3. Последний кадр получает остаток времени блока. Resolve может округлить видеомонтаж до сетки выбранного FPS.</p>
        </div>
        <button type="button" className={`${button} w-full bg-cyan-700 hover:bg-cyan-600`} disabled={busy || !data?.canExport || !settingsValid || !structureValid || Boolean(trimError) || Boolean(pathError)} onClick={generate}>{busy ? "Подготовка…" : "Сгенерировать Time Line"}</button>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-sm text-slate-300 space-y-2">
        <h2 className="font-bold text-white">Импорт в DaVinci Resolve</h2>
        <p>Откройте папку проекта на компьютере с Resolve. Рядом с XML должны находиться папки <code>images</code> и <code>audio</code>.</p>
        <p>В Resolve откройте <b>File → Import → Timeline</b> и выберите файл <code>.fcpxml</code>.</p>
      </section>
    </main>
  </div>;
}
