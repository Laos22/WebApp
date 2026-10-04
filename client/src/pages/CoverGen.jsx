import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProfileSelector from '../components/ProfileSelector';
import CoverStylePanel from '../components/CoverStylePanel';
import { getProject } from '../services/api';
import { getCoverDraft, saveCoverDraft } from '../services/coverDesignStorage';
import { coverRequest, savedCoverUrl, coverImageBlob, downloadCoverFile } from '../services/coverApi';

const inputClass = 'w-full rounded-xl border border-slate-700 bg-slate-950 p-3 disabled:opacity-60';
const buttonClass = 'rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white hover:bg-purple-500 disabled:opacity-50';
const emptyDraft = { title: '', subtitle: '', titleInstruction: '', instruction: '', image: null, workflow: 2 };

export default function CoverGen() {
  const { projectId } = useParams();
  const { user } = useAuth();
  return <CoverWorkflow key={`${user?._id || user?.id}:${projectId}`} projectId={projectId} userId={user?._id || user?.id || ''} />;
}

function CoverWorkflow({ projectId, userId }) {
  const storageId = `${userId}:${projectId}`;
  const [project, setProject] = useState(null);
  const [style, setStyle] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [provider, setProvider] = useState('studio');
  const [textProfile, setTextProfile] = useState('');
  const [imageProfile, setImageProfile] = useState('');
  const [analysisProfile, setAnalysisProfile] = useState('');
  const [styleInstruction, setStyleInstruction] = useState('');
  const [savedCover, setSavedCover] = useState(null);
  const [resultUrl, setResultUrl] = useState('');
  const alive = useRef(false);
  const lock = useRef(false);
  const importInput = useRef(null);

  useEffect(() => {
    alive.current = true;
    let current = true;
    Promise.all([getProject(projectId), coverRequest(projectId, 'style'),
      getCoverDraft(storageId).then(value => value || getCoverDraft(projectId)).catch(() => null),
    ]).then(([data, savedStyle, savedDraft]) => {
      if (!current) return;
      setProject(data.project); setStyle(savedStyle.style);
      setSavedCover(data.project.coverImage || null);
      setDraft(savedDraft ? {
        ...emptyDraft, title: savedDraft.title || '', subtitle: savedDraft.subtitle || '',
        titleInstruction: savedDraft.titleInstruction || '', instruction: savedDraft.instruction || savedDraft.direction || '',
        image: data.project.coverImage ? null : savedDraft.image || null, workflow: savedDraft.workflow || 1,
      } : { ...emptyDraft, title: data.project.coverData?.title || '' });
      setLoaded(true);
    }).catch(err => { if (current) setError(err.message); });
    return () => { current = false; alive.current = false; };
  }, [projectId, storageId]);

  useEffect(() => {
    if (!loaded || busy) return;
    const timer = setTimeout(() => {
      saveCoverDraft({ ...draft, image: null, projectId: storageId }).catch(() => {
        if (alive.current) setError('Не удалось сохранить текстовый черновик в браузере.');
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, loaded, busy, storageId]);

  useEffect(() => {
    if (!draft.image) { setResultUrl(savedCover ? savedCoverUrl(projectId, savedCover.savedAt) : ''); return; }
    const url = URL.createObjectURL(draft.image); setResultUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.image, savedCover, projectId]);

  const edit = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const run = async (name, action) => {
    if (lock.current) return;
    lock.current = true; setBusy(name); setError(''); setMessage('');
    try { await action(); }
    catch (err) { if (alive.current) setError(err.message || 'Не удалось выполнить действие.'); }
    finally { lock.current = false; if (alive.current) setBusy(''); }
  };
  const storeDraft = async next => {
    if (alive.current) setDraft(next);
    await saveCoverDraft({ ...next, image: null, projectId: storageId });
  };
  const uploadStyle = event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    run('style', async () => {
      if (file.size > 15 * 1024 * 1024) throw new Error('Пример должен быть не больше 15 МБ.');
      const result = await coverRequest(projectId, 'style', { method: 'PUT', file, field: 'image' });
      if (alive.current) setStyle(result.style);
      const analyzed = await coverRequest(projectId, 'style/analyze', { method: 'POST', body: { revision: result.style.revision, profileId: analysisProfile || undefined } });
      if (alive.current) { setStyle(analyzed.style); setStyleInstruction(''); setMessage('Анализ готов. Проверьте макет и примените шаблон или уточните его.'); }
    });
  };
  const analyzeStyle = () => run('analysis', async () => {
    const result = await coverRequest(projectId, 'style/analyze', { method: 'POST', body: { revision: style.revision, instruction: styleInstruction, profileId: analysisProfile || undefined } });
    if (alive.current) { setStyle(result.style); setStyleInstruction(''); setMessage('Шаблон подготовлен. Проверьте предпросмотр и подтвердите.'); }
  });
  const confirmStyle = () => run('confirm', async () => {
    const result = await coverRequest(projectId, 'style/confirm', { method: 'POST', body: { revision: style.revision } });
    if (alive.current) { setStyle(result.style); setMessage('Шаблон сохранён для всех проектов.'); }
  });
  const saveResult = () => run('save', async () => {
    const file = new File([draft.image], 'cover', { type: draft.image.type });
    const result = await coverRequest(projectId, 'save', { method: 'POST', file, field: 'image' });
    if (alive.current) { setSavedCover(result.cover); setMessage(`Обложка сохранена в папке проекта: cover/${result.cover.filename}`); }
    await storeDraft({ ...draft, image: null });
  });
  const propose = () => run('titles', async () => {
    const result = await coverRequest(projectId, 'headlines', { method: 'POST', body: {
      title: draft.title, subtitle: draft.subtitle, instruction: draft.titleInstruction, profileId: textProfile || undefined,
    } });
    await storeDraft({ ...draft, title: result.title, subtitle: result.subtitle });
    if (alive.current) setMessage('Заголовок и подзаголовок готовы. Их можно исправить вручную или уточнить инструкцию.');
  });
  const generate = () => run(provider, async () => {
    const body = { title: draft.title, subtitle: draft.subtitle, instruction: draft.instruction,
      styleRevision: style?.confirmed?.revision, profileId: imageProfile || undefined };
    if (provider === 'flow') {
      const zip = await coverRequest(projectId, 'flow/export', { method: 'POST', body, blob: true });
      downloadCoverFile(zip, `cover-flow-${projectId}.zip`);
      if (alive.current) setMessage('Пакет скачан: загрузите template.png в Google Flow и вставьте prompt.txt. Затем импортируйте результат и сохраните в проект.');
    } else {
      const result = await coverRequest(projectId, 'generate', { method: 'POST', body });
      await storeDraft({ ...draft, image: coverImageBlob(result), workflow: 2 });
      if (alive.current) setMessage('Обложка готова. Проверьте написание заголовка и подзаголовка на изображении.');
    }
  });
  const importResult = event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    run('import', async () => {
      if (file.size > 20 * 1024 * 1024) throw new Error('Файл для импорта должен быть не больше 20 МБ.');
      const result = await coverRequest(projectId, 'import', { method: 'POST', file });
      await storeDraft({ ...draft, image: coverImageBlob(result), workflow: 2 });
      if (alive.current) setMessage('Готовая обложка импортирована.');
    });
  };

  return <main className="min-h-screen bg-slate-950 text-white px-4 py-8 sm:p-8">
    <div className="mx-auto max-w-5xl space-y-6 text-left">
      <header><Link to={`/projects/${projectId}`} className="text-sm text-purple-300">← Назад к проекту</Link><h1 className="mt-3 text-3xl font-bold">Обложка видео</h1><p className="mt-1 text-slate-400">{project?.shortTitle || project?.title || 'Загрузка проекта…'}</p></header>
      {!loaded && error && <div role="alert" className="rounded-xl border border-red-500/40 p-4 text-red-200">{error}<button onClick={() => window.location.reload()} className="block mt-3 underline">Повторить загрузку</button></div>}
      {loaded && <>
        {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-red-200">{error}</p>}
        {message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <CoverStylePanel projectId={projectId} style={style} busy={busy} profile={analysisProfile} setProfile={setAnalysisProfile} instruction={styleInstruction} setInstruction={setStyleInstruction} upload={uploadStyle} analyze={analyzeStyle} confirm={confirmStyle} />
          <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4">
            <h2 className="text-lg font-semibold">2. Заголовок и подзаголовок</h2>
            <label className="block text-sm text-slate-300">Заголовок<input value={draft.title} maxLength={120} disabled={!!busy} onChange={event => edit('title', event.target.value)} className={`${inputClass} mt-1`} placeholder="НЕСАМОВИТЕ" /></label>
            <label className="block text-sm text-slate-300">Подзаголовок<input value={draft.subtitle} maxLength={180} disabled={!!busy} onChange={event => edit('subtitle', event.target.value)} className={`${inputClass} mt-1`} placeholder="ТАЄМНИЦЯ КАРПАТ" /></label>
            <label className="block text-sm text-slate-300">Инструкция для текста · необязательно<textarea rows={2} maxLength={4000} disabled={!!busy} value={draft.titleInstruction} onChange={event => edit('titleInstruction', event.target.value)} className={`${inputClass} mt-1`} placeholder="Например: сделай заголовок короче, добавь интригу в подзаголовок" /></label>
            <button type="button" disabled={!!busy} onClick={propose} className={`${buttonClass} w-full`}>{busy === 'titles' ? 'Предлагаем тексты…' : 'Предложить заголовок и подзаголовок'}</button>
            <details className="text-sm text-slate-400"><summary className="cursor-pointer">Профиль для текста</summary><div className="mt-3"><ProfileSelector type="text" value={textProfile} onChange={setTextProfile} projectId={projectId} operation="cover-text" disabled={!!busy} /></div></details>
          </section>
        </div>
        <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4">
          <h2 className="text-lg font-semibold">3. Сгенерировать обложку</h2>
          <label className="block text-sm text-slate-300">Пожелания к обложке · необязательно<textarea rows={3} maxLength={4000} disabled={!!busy} value={draft.instruction} onChange={event => edit('instruction', event.target.value)} className={`${inputClass} mt-1`} placeholder="Например: озеро крупнее, светлый рассвет, сохранить расположение текста как на примере" /></label>
          <div className="flex flex-wrap gap-3">{[['studio', 'Google Studio'], ['flow', 'Google Flow']].map(([value, label]) => <label key={value} className={`cursor-pointer rounded-xl border px-4 py-3 ${provider === value ? 'border-purple-400 bg-purple-950' : 'border-slate-700'}`}><input type="radio" name="coverProvider" value={value} checked={provider === value} disabled={!!busy} onChange={() => setProvider(value)} className="mr-2" />{label}</label>)}</div>
          {provider === 'studio' ? <details className="text-sm text-slate-400"><summary className="cursor-pointer">Профиль Google Studio</summary><div className="mt-3"><ProfileSelector type="image" provider="google_studio" value={imageProfile} onChange={setImageProfile} projectId={projectId} operation="cover-image" disabled={!!busy} /></div></details> : <p className="text-sm text-slate-400">Скачайте пакет с промптом и примером, сгенерируйте изображение в Google Flow и импортируйте результат. В ZIP результат должен называться cover.png, cover.jpg или cover.webp.</p>}
          <p className="text-xs text-slate-400">Используется промпт «Генерация обложки» из <Link to="/settings" className="text-purple-300 underline">настроек</Link>, утверждённый шаблон, тема проекта, оба текста и ваши пожелания. Исходное фото не передаётся. Заголовок и подзаголовок рисует сама модель.</p>
          {!style?.confirmed && <p className="text-sm text-amber-300">Сначала проанализируйте пример и примените шаблон.</p>}
          <div className="flex flex-col sm:flex-row gap-3">
            <button type="button" disabled={!!busy || !style?.confirmed || !draft.title.trim()} onClick={generate} className={buttonClass}>{busy === 'studio' ? 'Генерируем обложку…' : busy === 'flow' ? 'Готовим пакет…' : provider === 'studio' ? 'Сгенерировать обложку' : 'Скачать пакет Google Flow'}</button>
            <button type="button" disabled={!!busy} onClick={() => importInput.current?.click()} className="rounded-xl bg-slate-700 px-5 py-3 disabled:opacity-50">{busy === 'import' ? 'Импортируем…' : 'Импортировать результат · картинка / ZIP'}</button>
            <input ref={importInput} type="file" accept="image/png,image/jpeg,image/webp,.zip" onChange={importResult} className="hidden" />
          </div>
          {busy === 'studio' && <p role="status" className="text-sm text-purple-200">Генерация может занять несколько минут. Дождитесь результата перед закрытием вкладки.</p>}
        </section>
        {resultUrl && <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4">
          <h2 className="text-lg font-semibold">{!draft.image || draft.workflow === 2 ? 'Готовая обложка' : 'Изображение из предыдущего редактора'}</h2>
          <img src={resultUrl} alt="Результат генерации обложки" className="w-full max-h-[70vh] object-contain rounded-xl" />
          <button type="button" disabled={!!busy || !draft.image} onClick={saveResult} className={buttonClass}>{busy === 'save' ? 'Сохраняем…' : draft.image ? 'Сохранить в проект' : 'Сохранено в проекте'}</button>
          {savedCover && <p className="text-sm text-emerald-300">Сохранённый файл: {project?.projectPath ? `${project.projectPath}/cover/${savedCover.filename}` : `Google Drive / cover/${savedCover.filename}`}</p>}
          <p className="text-xs text-slate-400">{draft.image ? 'Новый результат ещё не сохранён. Нажмите «Сохранить в проект» перед закрытием страницы.' : 'При следующем открытии обложка загрузится из папки проекта.'} После изменения текста нужна повторная генерация.</p>
        </section>}
      </>}
    </div>
  </main>;
}
