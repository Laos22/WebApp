import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  analyzeReferencePlan, confirmReferencePlan, deleteVisualReference,
  detailReferencePrompt, getReferencePlan, getVisualReferenceImageUrl,
  saveReferencePlan, uploadVisualReference,
} from "../services/api";

const panel = "bg-slate-900/80 border border-slate-800 rounded-2xl p-5 md:p-6 space-y-4";
const button = "px-4 py-2.5 rounded-xl bg-fuchsia-700 hover:bg-fuchsia-600 disabled:opacity-50 disabled:cursor-not-allowed";
const types = { character: "Персонаж", location: "Локация", object: "Предмет", other: "Другое" };
const statuses = { empty: "Не анализировался", draft: "Черновик", confirmed: "Утверждён", stale: "Сценарий изменён" };
const MAX_FILE_SIZE = 15 * 1024 * 1024;

function editableItem(item) {
  return {
    ...(item.id ? { id: item.id } : {}), name: item.name || "", type: item.type || "other",
    description: item.description || "", reason: item.reason || "",
    mentions: Number.isSafeInteger(item.mentions) ? item.mentions : 0,
    prompt: item.prompt || "", selected: item.selected !== false,
  };
}

function readableError(error) {
  if (error?.status === 409) return error.message || "Данные изменились. Обновите страницу.";
  if (error?.status === 502) return "ИИ вернул некорректный результат. Уточните инструкцию и попробуйте снова.";
  return error?.message || "Не удалось выполнить операцию.";
}

export default function References() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);
  const [instructions, setInstructions] = useState("");
  const [pending, setPending] = useState("load");
  const [itemPending, setItemPending] = useState({});
  const [detailInstructions, setDetailInstructions] = useState({});
  const [files, setFiles] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);

  const applyData = (result) => {
    setData(result);
    setItems(result.referencePlan.items.map(editableItem));
    setInstructions(result.referencePlan.instructions || "");
  };

  useEffect(() => {
    mounted.current = true;
    let active = true;
    getReferencePlan(projectId).then(result => {
      if (active) {
        setData(result);
        setItems(result.referencePlan.items.map(editableItem));
        setInstructions(result.referencePlan.instructions || "");
      }
    }).catch(err => { if (active) setError(readableError(err)); })
      .finally(() => { if (active) setPending(""); });
    return () => { active = false; mounted.current = false; };
  }, [projectId]);

  const plan = data?.referencePlan;
  const baseline = useMemo(() => plan ? JSON.stringify({
    instructions: plan.instructions || "", items: plan.items.map(editableItem),
  }) : "", [plan]);
  const dirty = plan && JSON.stringify({ instructions, items }) !== baseline;
  const confirmed = plan?.status === "confirmed";
  const scriptReady = data?.scriptStatus === "confirmed";
  const voiceoverReady = data?.voiceoverStatus === "confirmed";

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const run = async (name, action, success) => {
    if (pending) return;
    setPending(name); setError(""); setMessage("");
    try { const result = await action(); if (mounted.current) { applyData(result); setMessage(success); } }
    catch (err) { if (mounted.current) setError(readableError(err)); }
    finally { if (mounted.current) setPending(""); }
  };

  const analyze = () => {
    if (items.length && !window.confirm("Повторный анализ обновит текущий список. Продолжить?")) return;
    run("analyze", () => analyzeReferencePlan(projectId, {
      instructions, items, expectedEditVersion: plan.editVersion, sourceScriptRevision: data.scriptRevision,
    }), "Анализ завершён. Проверьте предложенные референсы.");
  };

  const save = () => run("save", () => saveReferencePlan(projectId, {
    instructions, items, expectedEditVersion: plan.editVersion,
  }), "Изменения сохранены.");

  const confirm = () => run("confirm", () => confirmReferencePlan(projectId, {
    expectedEditVersion: plan.editVersion, sourceScriptRevision: data.scriptRevision,
  }), "Набор референсов утверждён.");

  const updateItem = (index, field, value) => setItems(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  const removeItem = (index) => {
    const source = plan.items[index];
    if (source?.image && !window.confirm("Удалить карточку и загруженное изображение?")) return;
    setItems(current => current.filter((_, i) => i !== index));
  };

  const runForItem = async (id, name, action) => {
    if (itemPending[id]) return;
    setItemPending(current => ({ ...current, [id]: name })); setError(""); setMessage("");
    try { const result = await action(); if (mounted.current) applyData(result); }
    catch (err) { if (mounted.current) setError(readableError(err)); }
    finally { if (mounted.current) setItemPending(current => ({ ...current, [id]: "" })); }
  };

  const detail = (item) => runForItem(item.id, "detail", () => detailReferencePrompt(projectId, item.id, {
    instruction: detailInstructions[item.id] || "",
    expectedEditVersion: plan.editVersion, sourceScriptRevision: data.scriptRevision,
  }));

  const upload = async (item) => {
    const file = files[item.id];
    if (!file) return setError("Сначала выберите изображение.");
    if (file.size > MAX_FILE_SIZE) return setError("Размер изображения не должен превышать 15 МБ.");
    await runForItem(item.id, "upload", async () => {
      await uploadVisualReference(projectId, item.id, { file, prompt: item.prompt, sourceReferenceVersion: item.version });
      setFiles(current => ({ ...current, [item.id]: null }));
      setMessage("Изображение загружено.");
      return getReferencePlan(projectId);
    });
  };

  const removeImage = async (item) => {
    if (!item.image || !window.confirm("Удалить изображение референса?")) return;
    await runForItem(item.id, "delete", async () => {
      await deleteVisualReference(projectId, item.image.id);
      setMessage("Изображение удалено.");
      return getReferencePlan(projectId);
    });
  };

  if (!data && pending === "load") return <div className="text-white p-12">Загрузка референсов…</div>;

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white p-6 md:p-12">
    <div className="max-w-5xl mx-auto space-y-6">
      <nav className="flex flex-wrap gap-4 text-sm text-fuchsia-300">
        <Link to={`/projects/${projectId}`}>← К проекту</Link>
        <Link to={`/projects/${projectId}/script`}>К сценарию</Link>
        <Link to={`/projects/${projectId}/audio`}>К озвучке</Link>
      </nav>
      <div><h1 className="text-3xl font-extrabold">Работа с референсами</h1>
        <p className="text-slate-400 mt-2">ИИ предлагает только значимые визуальные опоры. Финальный выбор остаётся за вами.</p></div>
      {error && <div role="alert" className="p-4 rounded-xl border border-red-500/30 bg-red-500/10">{error}</div>}
      {message && <div role="status" className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{message}</div>}
      {!scriptReady && <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300">Сначала подтвердите сценарий.</div>}
      {scriptReady && !voiceoverReady && <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300">Сначала адаптируйте и утвердите текст в разделе «Озвучка».</div>}
      {plan && <>
        <section className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">{statuses[plan.status] || plan.status}</h2>
            <span className="text-sm text-slate-400">Редакция сценария: {data.scriptRevision ?? "—"}</span>
          </div>
          {plan.status === "stale" && <p className="text-amber-300">Сценарий изменился. Выполните анализ заново.</p>}
          <label className="block"><span className="block text-sm text-slate-300 mb-2">Общие инструкции для анализа</span>
            <textarea maxLength={4000} value={instructions} onChange={event => setInstructions(event.target.value)}
              placeholder="Например: сделай акцент на исторических локациях; не добавляй второстепенных персонажей"
              className="w-full min-h-28 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={button} disabled={Boolean(pending) || !scriptReady || !voiceoverReady}
              onClick={analyze}>{pending === "analyze" ? "ИИ анализирует…" : items.length ? "Повторить анализ" : "Анализировать сценарий"}</button>
            {items.length > 0 && <button type="button" className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={Boolean(pending) || !dirty} onClick={save}>Сохранить изменения</button>}
            {items.length > 0 && <button type="button" className={`${button} bg-emerald-700 hover:bg-emerald-600`} disabled={Boolean(pending) || dirty || plan.status !== "draft" || !items.some(item => item.selected)} onClick={confirm}>Утвердить набор</button>}
            {confirmed && !dirty && <Link to={`/projects/${projectId}/image`} className={`${button} bg-purple-700 hover:bg-purple-600`}>Перейти к работе с изображениями</Link>}
          </div>
        </section>

        {items.map((item, index) => {
          const persisted = item.id ? plan.items.find(value => value.id === item.id) : null;
          const image = persisted?.image;
          const working = item.id ? itemPending[item.id] : "";
          return <article key={item.id || `new-${index}`} className={panel}>
            <div className="flex flex-wrap justify-between gap-3">
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={item.selected} onChange={event => updateItem(index, "selected", event.target.checked)} />Использовать в раскадровке</label>
              <span className="text-sm text-fuchsia-300">{types[item.type]}</span>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <label className="block"><span className="text-sm text-slate-400">Название</span><input value={item.name} maxLength={200} onChange={event => updateItem(index, "name", event.target.value)} className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg p-3" /></label>
              <label className="block"><span className="text-sm text-slate-400">Тип</span><select value={item.type} onChange={event => updateItem(index, "type", event.target.value)} className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg p-3">{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>
            <label className="block"><span className="text-sm text-slate-400">Описание</span><textarea value={item.description} maxLength={4000} onChange={event => updateItem(index, "description", event.target.value)} className="w-full min-h-24 mt-1 bg-slate-950 border border-slate-700 rounded-lg p-3" /></label>
            <div className="grid md:grid-cols-[1fr_180px] gap-4">
              <label className="block"><span className="text-sm text-slate-400">Почему нужен референс</span><textarea value={item.reason} maxLength={2000} onChange={event => updateItem(index, "reason", event.target.value)} className="w-full min-h-20 mt-1 bg-slate-950 border border-slate-700 rounded-lg p-3" /></label>
              <label className="block"><span className="text-sm text-slate-400">Упоминаний</span><input type="number" min="0" step="1" value={item.mentions} onChange={event => updateItem(index, "mentions", Math.max(0, Number.parseInt(event.target.value || "0", 10)))} className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg p-3" /></label>
            </div>
            <label className="block"><span className="text-sm text-slate-400">Prompt для Google Flow</span><textarea value={item.prompt} maxLength={12000} onChange={event => updateItem(index, "prompt", event.target.value)} placeholder="Можно оставить пустым и нажать «Детализировать prompt»" className="w-full min-h-40 mt-1 bg-slate-950 border border-slate-700 rounded-lg p-3" /></label>
            {item.id && <div className="border border-slate-700 rounded-xl p-4 space-y-3">
              <label className="block"><span className="text-sm text-slate-400">Дополнение для детализации (необязательно)</span><input value={detailInstructions[item.id] || ""} maxLength={2000} onChange={event => setDetailInstructions(current => ({ ...current, [item.id]: event.target.value }))} className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg p-3" placeholder="Например: подробнее про одежду и обувь" /></label>
              <button type="button" className={button} disabled={Boolean(pending) || Boolean(working) || dirty || plan.status === "stale"} onClick={() => detail(persisted)}>{working === "detail" ? "ИИ детализирует…" : "Детализировать prompt"}</button>
            </div>}
            {image && <div className="grid sm:grid-cols-[220px_1fr] gap-4 items-start">
              <img src={getVisualReferenceImageUrl(projectId, image.id, image.updatedAt)} alt={item.name || "Референс"} className="w-full max-h-72 object-contain rounded-xl border border-slate-700 bg-black" />
              <div className="space-y-2 text-sm text-slate-300"><p>{image.stale ? "Изображение устарело после изменения карточки" : "Изображение готово"}</p><p>{(image.byteSize / 1024 / 1024).toFixed(2)} МБ</p><button type="button" className={`${button} bg-red-700 hover:bg-red-600`} disabled={Boolean(working)} onClick={() => removeImage(persisted)}>{working === "delete" ? "Удаление…" : "Удалить изображение"}</button></div>
            </div>}
            {confirmed && item.selected && item.id && <div className="border border-fuchsia-500/20 rounded-xl p-4 space-y-3">
              <p className="font-semibold">Google Flow</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" className={button} disabled={!item.prompt} onClick={async () => { try { await navigator.clipboard.writeText(item.prompt); setMessage("Prompt скопирован."); } catch { setError("Не удалось скопировать prompt."); } }}>Скопировать prompt</button>
                <button type="button" className={`${button} bg-slate-700 hover:bg-slate-600`} onClick={() => window.open("https://flow.google.com/", "_blank", "noopener,noreferrer")}>Открыть Google Flow</button>
              </div>
              <ol className="list-decimal pl-5 text-sm text-slate-400 space-y-1"><li>Скопируйте prompt.</li><li>Создайте и скачайте изображение в Flow.</li><li>Загрузите лучший вариант сюда.</li></ol>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setFiles(current => ({ ...current, [item.id]: event.target.files?.[0] || null }))} />
              <button type="button" className={button} disabled={!files[item.id] || !item.prompt || Boolean(working)} onClick={() => upload(persisted)}>{working === "upload" ? "Загрузка…" : image ? "Заменить изображение" : "Загрузить изображение"}</button>
            </div>}
            <button type="button" className={`${button} bg-red-800 hover:bg-red-700`} disabled={Boolean(pending) || Boolean(working)} onClick={() => removeItem(index)}>Удалить карточку</button>
          </article>;
        })}
        {items.length > 0 && <button type="button" className={button} disabled={Boolean(pending)} onClick={() => setItems(current => [...current, editableItem({ selected: true })])}>Добавить референс</button>}
      </>}
    </div>
  </div>;
}
