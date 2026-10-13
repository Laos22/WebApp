import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  acceptFlowMusic, analyzeFlowMusic, backgroundMusicAudioUrl, flowMusicCandidateAudioUrl,
  getProject, saveFlowMusicPlan, uploadFlowMusicCandidate,
} from '../services/api';
import ProfileSelector from '../components/ProfileSelector';

const button = 'rounded-xl bg-purple-700 px-4 py-3 text-white hover:bg-purple-600 disabled:opacity-40';
const field = 'mt-1 w-full rounded-xl bg-slate-950 p-3';
const formatDuration = value => {
  if (!Number.isFinite(Number(value))) return '—';
  const seconds = Math.round(Number(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export default function BackgroundMusic() {
  const { projectId } = useParams();
  const [music, setMusic] = useState({ status: 'empty' });
  const [draft, setDraft] = useState(null);
  const [title, setTitle] = useState('');
  const [structure, setStructure] = useState('');
  const [prompt, setPrompt] = useState('');
  const [clipDurationSec, setClipDurationSec] = useState(120);
  const [clipChoice, setClipChoice] = useState('full');
  const [instructions, setInstructions] = useState('');
  const [analysisProfileId, setAnalysisProfileId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function applyDraft(value) {
    setDraft(value);
    setTitle(value?.title || '');
    setStructure(value?.structure || '');
    setPrompt(value?.prompt || '');
    setClipDurationSec(value?.clipDurationSec || 120);
    if (value) setClipChoice([90, 120, 180].includes(value.clipDurationSec) ? String(value.clipDurationSec) : 'custom');
  }

  useEffect(() => {
    getProject(projectId).then(result => {
      const project = result.project || result;
      setMusic(project.backgroundMusic || { status: 'empty' });
      applyDraft(project.flowMusicDraft || null);
    }).catch(err => setError(err.message));
  }, [projectId]);

  async function run(label, action) {
    setBusy(label); setError(''); setMessage('');
    try { await action(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  function analyze() {
    run('analyze', async () => {
      const result = await analyzeFlowMusic(projectId, {
        clipDurationSec: clipChoice === 'full' ? 'full' : Number(clipDurationSec), instructions,
        ...(analysisProfileId ? { profileId: analysisProfileId } : {}),
      });
      applyDraft(result.draft);
      setMessage('План готов. Проверьте структуру и промт перед отправкой в Flow Music.');
    });
  }

  function save() {
    run('save', async () => {
      const result = await saveCurrentPlan();
      applyDraft(result.draft);
      setMessage('Музыкальный план сохранён.');
    });
  }

  function saveCurrentPlan() {
    return saveFlowMusicPlan(projectId, { title, structure, prompt, clipDurationSec: Number(clipDurationSec) });
  }

  function copy(value, label) {
    run('copy', async () => {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} скопирован. Вставьте его в Flow Music.`);
    });
  }

  function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    run('upload', async () => {
      await saveCurrentPlan();
      const result = await uploadFlowMusicCandidate(projectId, file);
      applyDraft(result.draft);
      setMessage('Трек загружен. Прослушайте его перед принятием.');
    });
    event.target.value = '';
  }

  function accept() {
    run('accept', async () => {
      const result = await acceptFlowMusic(projectId);
      setMusic(result.music);
      applyDraft(result.draft);
      setMessage('Трек утверждён. В XML он будет повторён до конца ролика.');
    });
  }

  const target = Number(draft?.targetDurationSec);
  const candidateLength = Number(draft?.candidate?.durationSec);
  const repeatCount = target > 0 && candidateLength > 0 ? Math.ceil(target / candidateLength) : null;

  return <div className="mx-auto max-w-4xl space-y-6 p-4 text-slate-200 sm:p-8">
    <Link className="text-purple-300" to={`/projects/${projectId}`}>← К проекту</Link>
    <div><h1 className="text-3xl font-bold">Фоновая музыка · Flow Music</h1>
      <p className="mt-2 text-slate-400">Подготовьте зацикливаемый фрагмент по раскадровке. При экспорте XML он заполнит всю длину ролика.</p></div>
    {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-200">{error}</div>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}

    <section className="space-y-4 rounded-2xl border border-cyan-800/60 bg-cyan-950/20 p-5">
      <h2 className="text-xl font-semibold">1. Анализ раскадровки</h2>
      <p className="text-sm text-slate-400">Длительность ролика рассчитывается по озвучке и совпадает с расчётом XML. Если записи озвучки ещё нет, это оценка по тексту.</p>
      <label className="block">Длина одного фрагмента Flow Music
        <select value={clipChoice} onChange={e => { setClipChoice(e.target.value); if (e.target.value !== 'full' && e.target.value !== 'custom') setClipDurationSec(Number(e.target.value)); }} className={field}>
          <option value="full">Вся длина ролика, максимум 3 минуты</option>
          <option value="90">1:30 — циклично</option>
          <option value="120">2:00 — циклично</option>
          <option value="180">3:00 — циклично</option>
          <option value="custom">Другая длина</option>
        </select>
      </label>
      {clipChoice === 'custom' && <label className="block">Секунд (от 3 до 180)
        <input type="number" min="3" max="180" step="1" value={clipDurationSec} onChange={e => setClipDurationSec(e.target.value)} className={field} />
      </label>}
      <ProfileSelector type="text" projectId={projectId} operation="music-analysis" value={analysisProfileId} onChange={setAnalysisProfileId} disabled={Boolean(busy)} />
      <Link className="block text-sm text-purple-300 hover:underline" to="/settings?tab=prompts">Настройки → Промты → Анализ музыки Flow Music</Link>
      <button type="button" className={`${button} bg-cyan-700 hover:bg-cyan-600`} disabled={Boolean(busy)} onClick={analyze}>{busy === 'analyze' ? 'Анализирую…' : draft ? 'Повторить анализ' : 'Проанализировать проект'}</button>
      {draft && <p className="text-sm text-cyan-200">Длина ролика: около {formatDuration(target)}. Фрагмент: {formatDuration(clipDurationSec)}. XML повторит его столько раз, сколько потребуется.</p>}
    </section>

    {draft && <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="text-xl font-semibold">2. План и промт для Flow Music</h2>
      <label className="block">Название<input maxLength={160} value={title} onChange={e => setTitle(e.target.value)} className={field} /></label>
      <label className="block">Музыкальная структура<textarea maxLength={4100} value={structure} onChange={e => setStructure(e.target.value)} className={`${field} min-h-32`} /></label>
      <label className="block">Промт для Flow Music<textarea maxLength={4100} value={prompt} onChange={e => setPrompt(e.target.value)} className={`${field} min-h-40`} /></label>
      <p className="text-xs text-slate-400">Попросите Flow сделать ровный переход между концом и началом. XML повторяет MP3 без обработки стыков, поэтому проверьте их на слух.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={Boolean(busy)} onClick={save}>Сохранить план</button>
        <button type="button" className={`${button} bg-slate-700`} disabled={Boolean(busy) || !prompt.trim()} onClick={() => run('copy', async () => {
          await saveCurrentPlan();
          await navigator.clipboard.writeText(prompt);
          setMessage('Промт сохранён и скопирован. Вставьте его в Flow Music.');
        })}>Скопировать промт</button>
        <a className={`${button} inline-block bg-cyan-700`} href="https://www.flowmusic.app" target="_blank" rel="noreferrer">Открыть Flow Music ↗</a>
      </div>
    </section>}

    {draft && <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="text-xl font-semibold">3. Загрузить и прослушать</h2>
      <p className="text-sm text-slate-400">Создайте музыку в Flow Music, скачайте MP3 и загрузите его сюда. После прослушивания можно принять трек или изменить его в Flow Music и загрузить новую версию.</p>
      <label className="block">MP3 из Flow Music<input type="file" accept=".mp3,audio/mpeg" onChange={upload} disabled={Boolean(busy)} className={`${field} file:mr-4 file:rounded-lg file:border-0 file:bg-purple-700 file:px-3 file:py-2 file:text-white`} /></label>
      {busy === 'upload' && <p>Загружаю трек…</p>}
      {draft.candidate && <div className="space-y-3 rounded-xl border border-cyan-800 p-4">
        <p>Новый вариант: {formatDuration(candidateLength)} · {repeatCount ? `${repeatCount} повтор(а) до конца ролика` : 'повторение в XML'}</p>
        <audio controls preload="none" src={flowMusicCandidateAudioUrl(projectId, draft.candidate.uploadedAt)} className="w-full" />
        <button type="button" className={`${button} bg-emerald-700 hover:bg-emerald-600`} disabled={Boolean(busy)} onClick={accept}>{busy === 'accept' ? 'Принимаю…' : 'Принять трек для XML'}</button>
      </div>}
      <label className="block">Что изменить<textarea maxLength={2000} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Например: меньше ударных, более ровная петля…" className={`${field} min-h-24`} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${button} bg-slate-700`} disabled={Boolean(busy) || !instructions.trim()} onClick={() => copy(instructions, 'Инструкция')}>Скопировать для правки в Flow Music</button>
        <button type="button" className={`${button} bg-cyan-700`} disabled={Boolean(busy) || !instructions.trim()} onClick={analyze}>Обновить план по инструкции</button>
      </div>
    </section>}

    {music.status === 'ready' && <section className="space-y-3 rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-5">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="text-xl font-semibold">Утверждённый трек: {music.title || 'Фоновая музыка'}</h2><span className="text-slate-400">{formatDuration(music.durationSec)}</span></div>
      <p className="text-sm text-slate-400">{music.loop ? 'XML повторит этот фрагмент до конца ролика.' : 'Этот ранее созданный трек добавляется в XML один раз.'}</p>
      <audio controls preload="none" src={backgroundMusicAudioUrl(projectId, music.generatedAt)} className="w-full" />
      <a className="text-cyan-300" href={backgroundMusicAudioUrl(projectId, music.generatedAt)} download={music.filename}>Скачать MP3</a>
    </section>}
  </div>;
}
