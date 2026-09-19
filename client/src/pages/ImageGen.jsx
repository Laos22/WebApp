import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { confirmStoryboard, detailStoryboardFramePrompt, generateStoryboard, getStoryboard, resetStoryboardPromptDetails, saveStoryboard } from "../services/api";

const panel = "bg-slate-900/80 border border-slate-800 rounded-2xl p-5 md:p-6 space-y-4";
const button = "px-4 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed";
const statuses = { empty: "Не создана", draft: "Черновик", confirmed: "Утверждена", stale: "Устарела" };

function editableFrame(frame = {}) {
  return {
    ...(frame.id ? { id: frame.id } : {}),
    sourceVoiceoverBlockId: frame.sourceVoiceoverBlockId || "",
    scriptText: frame.scriptText || "",
    visualDescription: frame.visualDescription || "",
    prompt: frame.prompt || "",
    referenceIds: Array.isArray(frame.referenceIds) ? frame.referenceIds : [],
  };
}

function readableError(error) {
  if (error?.status === 409) return error.message || "Данные изменились. Обновите страницу.";
  if (error?.code === "STORYBOARD_TEXT_COVERAGE_MISMATCH") return "ИИ изменил текст озвучки при разделении на кадры. Попробуйте создать раскадровку заново.";
  if (error?.code === "STORYBOARD_FRAME_WORD_LIMIT_MISMATCH") return "Количество созданных кадров не позволяет распределить текст по 5–15 слов. Повторите генерацию.";
  if (error?.code === "STORYBOARD_DETAIL_FAILED") return "ИИ не смог детализировать prompt кадра. Повторите запрос.";
  if (error?.status === 502) return "ИИ вернул некорректную раскадровку. Уточните инструкцию и попробуйте снова.";
  if (error?.code === "STORYBOARD_INPUT_TOO_LONG") return "Данных слишком много для одного запроса. Сократите инструкции или текущие prompts.";
  return error?.message || "Не удалось выполнить операцию.";
}

export default function ImageGen() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [frames, setFrames] = useState([]);
  const [instructions, setInstructions] = useState("");
  const [detailInstruction, setDetailInstruction] = useState("");
  const [detailProgress, setDetailProgress] = useState(null);
  const [pending, setPending] = useState("load");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  const stopDetail = useRef(false);

  const applyData = (result) => {
    setData(result);
    setFrames(result.storyboard.frames.map(editableFrame));
    setInstructions(result.storyboard.instructions || "");
  };

  useEffect(() => {
    mounted.current = true;
    let active = true;
    getStoryboard(projectId).then(result => {
      if (active) {
        setData(result);
        setFrames(result.storyboard.frames.map(editableFrame));
        setInstructions(result.storyboard.instructions || "");
      }
    }).catch(err => { if (active) setError(readableError(err)); })
      .finally(() => { if (active) setPending(""); });
    return () => { active = false; mounted.current = false; stopDetail.current = true; };
  }, [projectId]);

  const storyboard = data?.storyboard;
  const baseline = useMemo(() => storyboard ? JSON.stringify({
    instructions: storyboard.instructions || "",
    frames: storyboard.frames.map(editableFrame),
  }) : "", [storyboard]);
  const dirty = Boolean(storyboard) && JSON.stringify({ instructions, frames }) !== baseline;
  const prerequisitesReady = data?.scriptStatus === "confirmed" && data?.voiceoverStatus === "confirmed" && data?.referencePlanStatus === "confirmed";
  const detailStats = useMemo(() => {
    const storedFrames = storyboard?.frames || [];
    const ready = storedFrames.filter(frame => frame.promptDetailStatus === "ready").length;
    const failed = storedFrames.filter(frame => frame.promptDetailStatus === "error").length;
    return { ready, failed, pending: storedFrames.length - ready, total: storedFrames.length };
  }, [storyboard]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const run = async (name, action, success) => {
    if (pending) return;
    setPending(name); setError(""); setMessage("");
    try {
      const result = await action();
      if (mounted.current) { applyData(result); setMessage(success); }
    } catch (err) {
      if (mounted.current) setError(readableError(err));
    } finally {
      if (mounted.current) setPending("");
    }
  };

  const generate = () => {
    if (frames.length && !window.confirm("ИИ обновит текущую раскадровку с учётом ваших правок. Продолжить?")) return;
    run("generate", () => generateStoryboard(projectId, {
      instructions, frames, expectedEditVersion: storyboard.editVersion,
      sourceScriptRevision: data.scriptRevision,
      sourceReferencePlanRevision: data.referencePlanRevision,
      sourceVoiceoverRevision: data.voiceoverRevision,
    }), "Раскадровка создана. Проверьте кадры и привязанные референсы.");
  };

  const generateFromScratch = () => {
    if (!window.confirm("Полностью пересоздать раскадровку? Текущие карточки не будут переданы ИИ.")) return;
    run("regenerate", () => generateStoryboard(projectId, {
      instructions, frames: [], expectedEditVersion: storyboard.editVersion,
      sourceScriptRevision: data.scriptRevision,
      sourceReferencePlanRevision: data.referencePlanRevision,
      sourceVoiceoverRevision: data.voiceoverRevision,
    }), "Раскадровка полностью пересоздана. Проверьте кадры и привязанные референсы.");
  };

  const detailOne = (frameId, currentData) => detailStoryboardFramePrompt(projectId, frameId, {
    instruction: detailInstruction,
    expectedEditVersion: currentData.storyboard.editVersion,
    sourceScriptRevision: currentData.storyboard.sourceScriptRevision,
    sourceReferencePlanRevision: currentData.storyboard.sourceReferencePlanRevision,
    sourceVoiceoverRevision: currentData.storyboard.sourceVoiceoverRevision,
  });

  const detailFrame = (frameId) => run(`detail:${frameId}`, () => detailOne(frameId, data), "Prompt кадра детализирован.");

  const detailAll = async (restart = false) => {
    if (pending || dirty || !frames.length) return;
    stopDetail.current = false;
    setPending("detail-all"); setError(""); setMessage("");
    let current = data;
    try {
      if (restart) {
        current = await resetStoryboardPromptDetails(projectId, {
          expectedEditVersion: current.storyboard.editVersion,
          sourceScriptRevision: current.storyboard.sourceScriptRevision,
          sourceReferencePlanRevision: current.storyboard.sourceReferencePlanRevision,
          sourceVoiceoverRevision: current.storyboard.sourceVoiceoverRevision,
        });
        if (mounted.current) applyData(current);
      }
      const targets = current.storyboard.frames
        .filter(frame => frame.promptDetailStatus !== "ready")
        .map(frame => frame.id);
      if (!targets.length) {
        if (mounted.current) {
          setDetailProgress({ done: 0, total: 0 });
          setMessage("Все промты уже детализированы.");
        }
        return;
      }
      setDetailProgress({ done: 0, total: targets.length });
      for (let index = 0; index < targets.length; index += 1) {
        if (stopDetail.current) break;
        current = await detailOne(targets[index], current);
        if (mounted.current) {
          applyData(current);
          setDetailProgress({ done: index + 1, total: targets.length });
        }
      }
      if (mounted.current) setMessage(stopDetail.current
        ? "Массовая детализация остановлена. Готовые промты сохранены."
        : "Все промты кадров детализированы.");
    } catch (err) {
      if (mounted.current) {
        setError(readableError(err));
        try { applyData(await getStoryboard(projectId)); } catch { /* keep last valid state */ }
      }
    } finally {
      if (mounted.current) setPending("");
    }
  };

  const save = () => run("save", () => saveStoryboard(projectId, {
    instructions, frames, expectedEditVersion: storyboard.editVersion,
  }), "Изменения раскадровки сохранены.");

  const confirm = () => run("confirm", () => confirmStoryboard(projectId, {
    expectedEditVersion: storyboard.editVersion,
    sourceScriptRevision: storyboard.sourceScriptRevision,
    sourceReferencePlanRevision: storyboard.sourceReferencePlanRevision,
    sourceVoiceoverRevision: storyboard.sourceVoiceoverRevision,
  }), "Раскадровка утверждена.");

  const updateFrame = (index, field, value) => setFrames(current =>
    current.map((frame, i) => i === index ? { ...frame, [field]: value } : frame));
  const moveFrame = (index, direction) => setFrames(current => {
    const target = index + direction;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const toggleReference = (index, referenceId) => {
    const current = frames[index].referenceIds;
    updateFrame(index, "referenceIds", current.includes(referenceId)
      ? current.filter(id => id !== referenceId) : [...current, referenceId]);
  };

  if (!data && pending === "load") return <div className="text-white p-12">Загрузка раскадровки…</div>;

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white p-6 md:p-12">
    <div className="max-w-5xl mx-auto space-y-6">
      <nav className="flex flex-wrap gap-4 text-sm text-purple-300">
        <Link to={`/projects/${projectId}`}>← К проекту</Link>
        <Link to={`/projects/${projectId}/script`}>К сценарию</Link>
        <Link to={`/projects/${projectId}/audio`}>К озвучке</Link>
        <Link to={`/projects/${projectId}/references`}>К референсам</Link>
      </nav>
      <div><h1 className="text-3xl font-extrabold">Раскадровка</h1>
        <p className="text-slate-400 mt-2">ИИ разделит сценарий на кадры, подготовит prompts и выберет подходящие референсы.</p></div>
      {error && <div role="alert" className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{error}</div>}
      {message && <div role="status" className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{message}</div>}
      {data && !prerequisitesReady && <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 space-y-2">
        <p>Для раскадровки нужны утверждённый текст озвучки и утверждённый набор референсов.</p>
        <Link className="underline" to={`/projects/${projectId}/references`}>Перейти к референсам</Link>
      </div>}

      {storyboard && <>
        <section className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">{statuses[storyboard.status] || storyboard.status}</h2>
            <span className="text-sm text-slate-400">Кадров: {frames.length}</span>
          </div>
          {storyboard.status === "stale" && <p className="text-amber-300">Сценарий или референсы изменились. Создайте раскадровку заново.</p>}
          <label className="block"><span className="block text-sm text-slate-300 mb-2">Общие инструкции</span>
            <textarea value={instructions} maxLength={4000} onChange={event => setInstructions(event.target.value)}
              placeholder="Например: больше крупных планов; один кадр на каждые два предложения; избегай повторяющихся композиций"
              className="w-full min-h-28 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>
          {frames.length > 0 && <label className="block"><span className="block text-sm text-slate-300 mb-2">Общая инструкция для детализации промтов</span>
            <textarea value={detailInstruction} maxLength={2000} onChange={event => setDetailInstruction(event.target.value)}
              placeholder="Например: фотореализм, больше деталей окружения, кинематографическое освещение"
              className="w-full min-h-24 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={button} disabled={Boolean(pending) || !prerequisitesReady} onClick={generate}>{pending === "generate" ? "ИИ создаёт кадры…" : frames.length ? "Обновить с помощью ИИ" : "Создать раскадровку"}</button>
            {frames.length > 0 && <button type="button" className={`${button} bg-amber-700 hover:bg-amber-600`} disabled={Boolean(pending) || !prerequisitesReady} onClick={generateFromScratch}>{pending === "regenerate" ? "ИИ пересоздаёт кадры…" : "Пересоздать с нуля"}</button>}
            {frames.length > 0 && <button type="button" className={`${button} bg-fuchsia-700 hover:bg-fuchsia-600`} disabled={Boolean(pending) || dirty || !prerequisitesReady || detailStats.pending === 0} onClick={() => detailAll(false)}>{pending === "detail-all" ? "ИИ детализирует промты…" : "Продолжить детализацию"}</button>}
            {frames.length > 0 && <button type="button" className={`${button} bg-violet-800 hover:bg-violet-700`} disabled={Boolean(pending) || dirty || !prerequisitesReady} onClick={() => { if (window.confirm("Начать детализацию всех промтов заново с первого кадра?")) detailAll(true); }}>Начать заново детализацию</button>}
            {pending === "detail-all" && <button type="button" className={`${button} bg-red-800 hover:bg-red-700`} onClick={() => { stopDetail.current = true; }}>Остановить детализацию</button>}
            {frames.length > 0 && <button type="button" className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={Boolean(pending) || !dirty || storyboard.status === "stale"} onClick={save}>Сохранить изменения</button>}
            {frames.length > 0 && <button type="button" className={`${button} bg-emerald-700 hover:bg-emerald-600`} disabled={Boolean(pending) || dirty || storyboard.status !== "draft"} onClick={confirm}>Утвердить раскадровку</button>}
          </div>
          {detailProgress && <p className="text-sm text-fuchsia-300">Детализировано: {detailProgress.done}/{detailProgress.total}</p>}
          {frames.length > 0 && <p className="text-sm text-slate-400">
            Сохранённый прогресс: <span className="text-emerald-400">готово {detailStats.ready}</span> из {detailStats.total}
            {detailStats.failed > 0 ? <span className="text-red-400"> · ошибок {detailStats.failed}</span> : null}
          </p>}
          {dirty && frames.length > 0 && <p className="text-sm text-amber-300">Сохраните изменения карточек перед детализацией промтов.</p>}
          {storyboard.status === "confirmed" && !dirty && <p className="text-emerald-300">Раскадровка готова для следующего этапа — генерации изображений.</p>}
        </section>

        {frames.map((frame, index) => {
          const detailStatus = storyboard.frames.find(item => item.id === frame.id)?.promptDetailStatus || "pending";
          return <article key={frame.id || `new-${index}`} className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Кадр {index + 1}</h2><div className="flex gap-2">
            <button type="button" className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={index === 0 || Boolean(pending)} onClick={() => moveFrame(index, -1)}>↑</button>
            <button type="button" className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={index === frames.length - 1 || Boolean(pending)} onClick={() => moveFrame(index, 1)}>↓</button>
          </div></div>
          <label className="block"><span className="text-sm text-slate-400">Блок озвучки</span><select value={frame.sourceVoiceoverBlockId} onChange={event => updateFrame(index, "sourceVoiceoverBlockId", event.target.value)} className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3"><option value="">Выберите блок</option>{data.voiceoverBlocks.map(block => <option key={block.id} value={block.id}>Блок {block.order}: {block.sourceTitle}</option>)}</select></label>
          <label className="block"><span className="text-sm text-slate-400">Точный фрагмент текста озвучки</span><textarea value={frame.scriptText} maxLength={4000} onChange={event => updateFrame(index, "scriptText", event.target.value)} className="w-full min-h-24 mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>
          <label className="block"><span className="text-sm text-slate-400">Что происходит в кадре</span><textarea value={frame.visualDescription} maxLength={4000} onChange={event => updateFrame(index, "visualDescription", event.target.value)} className="w-full min-h-28 mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>
          <label className="block"><span className="text-sm text-slate-400">Prompt для изображения</span><textarea value={frame.prompt} maxLength={12000} onChange={event => updateFrame(index, "prompt", event.target.value)} className="w-full min-h-40 mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>
          <p className={`text-xs ${detailStatus === "ready" ? "text-emerald-400" : detailStatus === "error" ? "text-red-400" : "text-slate-500"}`}>
            Детализация: {detailStatus === "ready" ? "готово" : detailStatus === "error" ? "ошибка — будет повторено при продолжении" : "ожидает"}
          </p>
          <button type="button" className={`${button} bg-fuchsia-700 hover:bg-fuchsia-600`} disabled={Boolean(pending) || dirty || !prerequisitesReady} onClick={() => detailFrame(frame.id)}>
            {pending === `detail:${frame.id}` ? "ИИ детализирует…" : "Детализировать prompt"}
          </button>
          <fieldset className="border border-slate-700 rounded-xl p-4 space-y-3"><legend className="px-2 text-sm text-slate-300">Референсы этого кадра</legend>
            {data.references.length ? <div className="grid sm:grid-cols-2 gap-2">{data.references.map(reference => <label key={reference.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-950/60"><input type="checkbox" checked={frame.referenceIds.includes(reference.id)} onChange={() => toggleReference(index, reference.id)} /><span><span className="block">{reference.name}</span><span className={`text-xs ${reference.imageReady ? "text-emerald-400" : "text-slate-500"}`}>{reference.imageReady ? "Изображение загружено" : "Только текстовый референс"}</span></span></label>)}</div> : <p className="text-slate-500">Нет выбранных референсов.</p>}
          </fieldset>
          <button type="button" className={`${button} bg-red-800 hover:bg-red-700`} disabled={Boolean(pending)} onClick={() => { if (window.confirm(`Удалить кадр ${index + 1}?`)) setFrames(current => current.filter((_, i) => i !== index)); }}>Удалить кадр</button>
        </article>})}

        {frames.length > 0 && <button type="button" className={button} disabled={Boolean(pending)} onClick={() => setFrames(current => [...current, editableFrame({ sourceVoiceoverBlockId: data.voiceoverBlocks[0]?.id || "" })])}>Добавить кадр</button>}
      </>}
    </div>
  </div>;
}
