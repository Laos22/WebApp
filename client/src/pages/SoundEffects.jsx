import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addSoundDesignFrame, analyzeSoundDesign, createSoundEffect, getProject, getSoundEffects, getStoryboardFramePreviewUrl, removeSoundDesignFrame, soundEffectAudioUrl } from '../services/api';
import { frameLabel } from '../utils/frameLabel';

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
  const [soundPlan, setSoundPlan] = useState({ status: 'empty', suggestions: [] });
  const [analyzing, setAnalyzing] = useState(false);
  const [frames, setFrames] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [frameToAdd, setFrameToAdd] = useState('');
  const [editingSuggestionId, setEditingSuggestionId] = useState('');
  const [editingPrompt, setEditingPrompt] = useState('');

  const load = () => Promise.all([getSoundEffects(projectId), getProject(projectId)]).then(([result, projectResult]) => { setEffects(result.soundEffects || []); setSoundPlan(result.soundPlan || { status: 'empty', suggestions: [] }); const project = projectResult.project || projectResult; setFrames(project.storyboard?.frames || []); setBlocks(project.voiceover?.blocks || []); });
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

  async function analyze() {
    if (analyzing) return;
    setAnalyzing(true); setError(''); setMessage('');
    try { const result = await analyzeSoundDesign(projectId); setSoundPlan(result.soundPlan); setMessage('Анализ завершён. Проверьте предложения звуков.'); }
    catch (err) { setError(err.message); }
    finally { setAnalyzing(false); }
  }

  async function addFrame() {
    if (!frameToAdd) return;
    try { const result = await addSoundDesignFrame(projectId, frameToAdd); setSoundPlan(result.soundPlan); setFrameToAdd(''); setMessage('Кадр добавлен в звуковой план.'); }
    catch (err) { setError(err.message); }
  }

  async function removeFrame(frameId) {
    try { const result = await removeSoundDesignFrame(projectId, frameId); setSoundPlan(result.soundPlan); setMessage('Кадр удалён из звукового плана.'); }
    catch (err) { setError(err.message); }
  }

  async function generateSuggestion(suggestion, customPrompt = '') {
    setError(''); setMessage('');
    try {
      const result = await createSoundEffect(projectId, {
        name: `${frameLabel(frames.find(item => item.id === suggestion.frameId), frames, blocks)}: звуковой эффект`,
        prompt: customPrompt.trim() || suggestion.prompt, durationSec: suggestion.durationSec,
        loop: suggestion.loop, promptInfluence: suggestion.promptInfluence, suggestionId: suggestion.id,
      });
      setEffects(previous => [result.soundEffect, ...previous]);
      setSoundPlan(previous => ({ ...previous, suggestions: previous.suggestions.map(item => item.id === suggestion.id ? { ...item, status: 'generated', effectId: result.soundEffect.id } : item) }));
      setEditingSuggestionId(''); setEditingPrompt('');
      setMessage(`Звук для ${frameLabel(frames.find(item => item.id === suggestion.frameId), frames, blocks)} создан.`);
    } catch (err) { setError(err.message); }
  }

  function startSuggestionEdit(suggestion, effect) {
    setEditingSuggestionId(suggestion.id);
    setEditingPrompt(effect?.sourcePrompt || '');
  }

  const effectsById = new Map(effects.map(effect => [effect.id, effect]));
  const manualEffects = effects.filter(effect => !soundPlan.suggestions?.some(suggestion => suggestion.effectId === effect.id));
  const sortedSuggestions = [...(soundPlan.suggestions || [])].sort((left, right) => {
    const leftFrame = frames.find(frame => frame.id === left.frameId);
    const rightFrame = frames.find(frame => frame.id === right.frameId);
    return (leftFrame?.order ?? left.frameOrder) - (rightFrame?.order ?? right.frameOrder);
  });

  return <div className="mx-auto max-w-5xl p-4 sm:p-8 text-slate-200 space-y-6">
    <Link className="text-purple-300" to={`/projects/${projectId}`}>← К проекту</Link>
    <div><h1 className="text-3xl font-bold">Звуки и эффекты</h1><p className="mt-2 text-slate-400">Создавайте атмосферу и отдельные звуковые эффекты через ElevenLabs.</p></div>
    {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-200">{error}</div>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
    <form onSubmit={generate} className="sticky top-3 z-10 rounded-2xl border border-purple-800/70 bg-slate-950/95 p-4 shadow-2xl backdrop-blur space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Создать звук вручную</h2><span className="text-xs text-slate-500">Можно писать по-русски — приложение переведёт промт</span></div>
      <div className="grid gap-3 md:grid-cols-[1fr_1.6fr_150px]">
        <label className="text-sm">Название<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Например: Дождь" className="mt-1 w-full rounded-lg bg-slate-900 p-2.5" /></label>
        <label className="text-sm">Промт<textarea required maxLength={450} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Сильный дождь по стеклу, далёкий гром" className="mt-1 h-11 w-full resize-none rounded-lg bg-slate-900 p-2.5" /></label>
        <label className="text-sm">Длительность<input type="number" min="0.5" max="30" step="0.1" value={durationSec} onChange={e => setDurationSec(e.target.value)} placeholder="Авто" className="mt-1 w-full rounded-lg bg-slate-900 p-2.5" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} className="size-4 accent-purple-500" />Бесшовный цикл</label><label className="flex min-w-52 items-center gap-2">Влияние: {Number(influence).toFixed(1)}<input type="range" min="0" max="1" step="0.1" value={influence} onChange={e => setInfluence(e.target.value)} className="accent-purple-500" /></label><button className={`${button} ml-auto px-4 py-2`} disabled={busy}>{busy ? 'Генерирую…' : 'Создать звук'}</button></div>
      {manualEffects.length > 0 && <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-2">{manualEffects.slice(0, 4).map(effect => <audio key={effect.id} controls preload="none" src={soundEffectAudioUrl(projectId, effect.id, effect.generatedAt)} className="h-8 max-w-60" />)}</div>}
    </form>
    <section className="rounded-2xl border border-cyan-800/60 bg-cyan-950/20 p-5 space-y-3">
      <div><h2 className="text-xl font-semibold">Предложения по раскадровке</h2><p className="mt-1 text-sm text-slate-400">ИИ найдёт кадры, которым нужен звук, и подготовит английские промты для ElevenLabs.</p></div>
      <div className="flex flex-wrap gap-2"><select value={frameToAdd} onChange={event => setFrameToAdd(event.target.value)} className="min-w-64 flex-1 rounded-xl bg-slate-950 p-3"><option value="">Выберите кадр для добавления</option>{frames.filter(frame => !soundPlan.suggestions?.some(item => item.frameId === frame.id)).map(frame => <option key={frame.id} value={frame.id}>{frameLabel(frame, frames, blocks)}: {(frame.scriptText || '').slice(0, 70)}</option>)}</select><button type="button" className={secondary} disabled={!frameToAdd} onClick={addFrame}>Добавить кадр</button></div>
      <button type="button" className={`${button} bg-cyan-700 hover:bg-cyan-600`} disabled={analyzing} onClick={analyze}>{analyzing ? 'Анализирую раскадровку…' : 'Проанализировать кадры'}</button>
      {sortedSuggestions.length > 0 && <div className="space-y-3 pt-2">{sortedSuggestions.map(suggestion => { const effect = effectsById.get(suggestion.effectId); const editing = editingSuggestionId === suggestion.id; const frame = frames.find(item => item.id === suggestion.frameId); const imageUrl = frame ? getStoryboardFramePreviewUrl(projectId, frame.id, frame.image?.updatedAt || frame.updatedAt || '0') : ''; const label = frameLabel(frame, frames, blocks); return <article key={suggestion.id} className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 space-y-3"><div className="flex gap-4"><div className="w-48 shrink-0"><div className="aspect-video overflow-hidden rounded-lg bg-slate-900">{imageUrl && <img src={imageUrl} alt={label} className="h-full w-full object-cover" />}</div></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{label}</h3><div className="flex items-center gap-2"><span className="text-xs text-slate-400">{suggestion.status === 'generated' ? 'Сгенерирован' : 'Предложен'}</span><button type="button" className="text-xs text-red-300 hover:text-red-200" onClick={() => removeFrame(suggestion.frameId)}>Удалить</button></div></div><p className="mt-1 text-sm text-slate-200">{frame?.scriptText || 'Текст кадра недоступен'}</p><p className="mt-1 text-sm text-slate-400">{suggestion.reason}</p></div></div>{effect?.status === 'ready' ? <div className="flex flex-wrap items-center gap-3"><audio controls preload="none" src={soundEffectAudioUrl(projectId, effect.id, effect.generatedAt)} className="h-9 max-w-full" /><a className={secondary} href={soundEffectAudioUrl(projectId, effect.id, effect.generatedAt)} download={effect.filename}>Скачать MP3</a></div> : null}{editing ? <div className="space-y-2"><textarea autoFocus value={editingPrompt} onChange={event => setEditingPrompt(event.target.value)} placeholder="Опишите звук по-русски" className="min-h-20 w-full rounded-lg bg-slate-900 p-2.5" /><div className="flex gap-2"><button type="button" className={button} disabled={!editingPrompt.trim()} onClick={() => generateSuggestion(suggestion, editingPrompt)}>Пересоздать звук</button><button type="button" className={secondary} onClick={() => setEditingSuggestionId('')}>Отмена</button></div></div> : <div className="flex flex-wrap gap-2">{suggestion.status !== 'generated' && <button type="button" className={button} onClick={() => generateSuggestion(suggestion)}>Сгенерировать звук</button>}<button type="button" className={secondary} onClick={() => startSuggestionEdit(suggestion, effect)}>Редактировать и пересоздать</button></div>}</article>; })}</div>}
      {soundPlan.status === 'ready' && !soundPlan.suggestions?.length && <p className="text-sm text-slate-400">Подходящих звуковых событий не найдено.</p>}
    </section>
  </div>;
}
