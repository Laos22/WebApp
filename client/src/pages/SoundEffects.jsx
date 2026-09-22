import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createSoundEffect, getSoundEffects, soundEffectAudioUrl } from '../services/api';

const button = 'rounded-xl bg-purple-700 px-4 py-3 text-white disabled:opacity-40';
const secondary = 'rounded-xl border border-slate-600 px-4 py-3 text-slate-200';

export default function SoundEffects() {
  const { projectId } = useParams();
  const [effects, setEffects] = useState([]);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [durationSec, setDurationSec] = useState('');
  const [loop, setLoop] = useState(false);
  const [influence, setInfluence] = useState(0.3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = () => getSoundEffects(projectId).then(result => setEffects(result.soundEffects || []));
  useEffect(() => { load().catch(err => setError(err.message)); }, [projectId]);

  async function generate(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await createSoundEffect(projectId, {
        name, prompt, loop, promptInfluence: Number(influence),
        durationSec: durationSec === '' ? null : Number(durationSec),
      });
      setEffects(previous => [result.soundEffect, ...previous]);
      setName(''); setPrompt(''); setDurationSec(''); setLoop(false);
      setMessage('Звуковой эффект создан.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-5xl p-4 sm:p-8 text-slate-200 space-y-6">
    <Link className="text-purple-300" to={`/projects/${projectId}`}>← К проекту</Link>
    <div><h1 className="text-3xl font-bold">Звуки и эффекты</h1><p className="mt-2 text-slate-400">Создавайте атмосферу и отдельные звуковые эффекты через ElevenLabs.</p></div>
    {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-200">{error}</div>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
    <form onSubmit={generate} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
      <h2 className="text-xl font-semibold">Создать новый звук</h2>
      <label className="block">Название<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Например: Дождь за окном" className="mt-1 w-full rounded-xl bg-slate-950 p-3" /></label>
      <label className="block">Описание звучания<textarea required maxLength={450} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Мягкий дождь по стеклу, далёкий гром, кинематографичная атмосфера" className="mt-1 min-h-28 w-full rounded-xl bg-slate-950 p-3" /></label>
      <div className="grid gap-4 sm:grid-cols-2"><label>Длительность, сек. (необязательно)<input type="number" min="0.5" max="30" step="0.1" value={durationSec} onChange={e => setDurationSec(e.target.value)} placeholder="Авто" className="mt-1 w-full rounded-xl bg-slate-950 p-3" /></label><label>Влияние описания: {Number(influence).toFixed(1)}<input type="range" min="0" max="1" step="0.1" value={influence} onChange={e => setInfluence(e.target.value)} className="mt-3 w-full accent-purple-500" /></label></div>
      <label className="flex items-center gap-3"><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} className="size-5 accent-purple-500" />Бесшовный цикл для фонового звука</label>
      <button className={button} disabled={busy}>{busy ? 'Генерирую звук…' : 'Создать звуковой эффект'}</button>
    </form>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Созданные эффекты</h2>{!effects.length && <p className="text-slate-400">Пока нет созданных звуков.</p>}{effects.map(effect => <article key={effect.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{effect.name}</h3><p className="text-sm text-slate-400">{effect.prompt}</p></div><span className="text-sm text-slate-400">{effect.durationSec ? `${effect.durationSec} сек.` : 'Авто'}{effect.loop ? ' · цикл' : ''}</span></div>{effect.status === 'ready' && <div className="flex flex-wrap items-center gap-3"><audio controls preload="none" src={soundEffectAudioUrl(projectId, effect.id, effect.generatedAt)} className="h-10 max-w-full" /><a className={secondary} href={soundEffectAudioUrl(projectId, effect.id, effect.generatedAt)} download={effect.filename}>Скачать MP3</a></div>}</article>)}</section>
  </div>;
}
