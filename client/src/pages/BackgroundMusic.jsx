import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { analyzeBackgroundMusic, backgroundMusicAudioUrl, generateBackgroundMusic, getProject } from '../services/api';

const button = 'rounded-xl bg-purple-700 px-4 py-3 text-white disabled:opacity-40';

export default function BackgroundMusic() {
  const { projectId } = useParams();
  const [music, setMusic] = useState({ status: 'empty' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [durationSec, setDurationSec] = useState(60);

  useEffect(() => { getProject(projectId).then(result => { const value = result.project?.backgroundMusic || result.backgroundMusic || { status: 'empty' }; setMusic(value); setPrompt(value.sourcePrompt || ''); setTitle(value.title || ''); setDurationSec(value.durationSec || 60); }).catch(err => setError(err.message)); }, [projectId]);

  async function analyze() {
    setBusy('analyze'); setError(''); setMessage('');
    try { const result = await analyzeBackgroundMusic(projectId); setMusic(result.music); setPrompt(result.music.sourcePrompt || ''); setTitle(result.music.title); setDurationSec(result.music.durationSec); setMessage('Музыкальный план готов. При необходимости внесите русские корректировки.'); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  async function generate(event) {
    event?.preventDefault(); setBusy('generate'); setError(''); setMessage('');
    try { const result = await generateBackgroundMusic(projectId, { title, prompt, durationSec: Number(durationSec) }); setMusic(result.music); setPrompt(result.music.sourcePrompt || prompt); setMessage('Фоновая музыка создана.'); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  return <div className="mx-auto max-w-4xl p-4 sm:p-8 text-slate-200 space-y-6">
    <Link className="text-purple-300" to={`/projects/${projectId}`}>← К проекту</Link>
    <div><h1 className="text-3xl font-bold">Фоновая музыка</h1><p className="mt-2 text-slate-400">Создайте инструментальную дорожку на основе сценария и раскадровки.</p></div>
    {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-200">{error}</div>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
    <section className="rounded-2xl border border-cyan-800/60 bg-cyan-950/20 p-5 space-y-4">
      <div><h2 className="text-xl font-semibold">Музыкальный план</h2><p className="mt-1 text-sm text-slate-400">ИИ определит настроение, инструменты, темп и музыкальную дугу всего ролика.</p></div>
      <button type="button" className={`${button} bg-cyan-700 hover:bg-cyan-600`} disabled={Boolean(busy)} onClick={analyze}>{busy === 'analyze' ? 'Анализирую проект…' : 'Проанализировать проект'}</button>
    </section>
    <form onSubmit={generate} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
      <h2 className="text-xl font-semibold">Настройки трека</h2>
      <label className="block">Название<input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="Например: Cinematic journey" className="mt-1 w-full rounded-xl bg-slate-950 p-3" /></label>
      <label className="block">Описание музыки<textarea required maxLength={4100} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Спокойная кинематографичная инструментальная музыка..." className="mt-1 min-h-32 w-full rounded-xl bg-slate-950 p-3" /><span className="mt-1 block text-xs text-slate-500">Можно редактировать по-русски — перед генерацией описание будет переведено на английский.</span></label>
      <label className="block">Длительность, секунд<input type="number" min="3" max="600" step="1" value={durationSec} onChange={e => setDurationSec(e.target.value)} className="mt-1 w-full rounded-xl bg-slate-950 p-3" /></label>
      <button className={button} disabled={Boolean(busy) || !prompt.trim()}>{busy === 'generate' ? 'Генерирую музыку…' : music.status === 'ready' ? 'Редактировать и пересоздать' : 'Сгенерировать фоновую музыку'}</button>
    </form>
    {music.status === 'ready' && <section className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-5 space-y-3"><div className="flex flex-wrap justify-between gap-2"><h2 className="text-xl font-semibold">{music.title || 'Фоновая музыка'}</h2><span className="text-slate-400">{music.durationSec} сек.</span></div><audio controls preload="none" src={backgroundMusicAudioUrl(projectId, music.generatedAt)} className="w-full" /><a className="text-cyan-300" href={backgroundMusicAudioUrl(projectId, music.generatedAt)} download={music.filename}>Скачать MP3</a></section>}
  </div>;
}
