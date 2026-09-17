import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getVisualBible, generateVisualBibleDraft, confirmVisualBible, updateVisualBible } from "../services/api";

const styleLabels = {
  concept: "Концепция", realism: "Реализм", colorPalette: "Цветовая палитра",
  lightingRules: "Освещение", cameraRules: "Камера", textureRules: "Текстуры",
  promptAnchorEn: "Визуальный ориентир (EN)", avoid: "Чего избегать",
};
const commonLabels = { sourceFacts: "Факты сценария", designDecisions: "Художественные решения" };
const sections = [
  ["visualModes", "Визуальные режимы", {
    purpose: "Назначение", styleEn: "Стиль (EN)", paletteEn: "Палитра (EN)",
    lightingOptionsEn: "Варианты освещения (EN)", cameraOptionsEn: "Варианты камеры (EN)",
    atmosphereOptionsEn: "Атмосфера (EN)", avoidEn: "Чего избегать (EN)",
  }],
  ["characters", "Персонажи", {
    ...commonLabels, role: "Роль", recurring: "Повторяющийся персонаж",
    identityAnchorEn: "Визуальный ориентир (EN)", defaultWardrobeEn: "Одежда (EN)", optionalPropsEn: "Реквизит (EN)",
  }],
  ["locations", "Локации", {
    ...commonLabels, identityAnchorEn: "Визуальный ориентир (EN)", variableConditionsEn: "Переменные условия (EN)",
  }],
  ["objects", "Объекты", { ...commonLabels, visualAnchorEn: "Визуальный ориентир (EN)" }],
];
const contentFields = {
  visualStyle: { concept: "text", realism: "text", colorPalette: "list", lightingRules: "list", cameraRules: "list", textureRules: "list", promptAnchorEn: "text", avoid: "list" },
  visualModes: { name: "text", purpose: "text", styleEn: "text", paletteEn: "text", lightingOptionsEn: "list", cameraOptionsEn: "list", atmosphereOptionsEn: "list", avoidEn: "list" },
  characters: { name: "text", sourceFacts: "list", designDecisions: "list", role: "text", recurring: "boolean", identityAnchorEn: "text", defaultWardrobeEn: "text", optionalPropsEn: "list" },
  locations: { name: "text", sourceFacts: "list", designDecisions: "list", identityAnchorEn: "text", variableConditionsEn: "list" },
  objects: { name: "text", sourceFacts: "list", designDecisions: "list", visualAnchorEn: "text" },
};
const statuses = { empty: "Не создана", draft: "Черновик", confirmed: "Подтверждено", stale: "Устарела" };
const panel = "bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4";
const button = "px-4 py-3 rounded-xl bg-purple-700 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed";

const copyBible = (bible) => JSON.parse(JSON.stringify(bible));
const listToText = (value) => Array.isArray(value) ? value.join("\n") : "";
const textToDraftList = (value) => value.split("\n");

function contentFromBible(bible) {
  const mapFields = (item, fields) => Object.fromEntries(Object.entries(fields).map(([key, type]) => {
    const value = item?.[key];
    return [key, type === "list" ? (Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : [])
      : type === "boolean" ? Boolean(value) : typeof value === "string" ? value : ""];
  }));
  const collection = (key) => (Array.isArray(bible?.[key]) ? bible[key] : []).map(item => ({
    ...(typeof item.id === "string" && item.id ? { id: item.id } : {}),
    ...mapFields(item, contentFields[key]),
  }));
  return {
    visualStyle: mapFields(bible?.visualStyle, contentFields.visualStyle),
    continuityRules: Array.isArray(bible?.continuityRules) ? bible.continuityRules.map(item => String(item).trim()).filter(Boolean) : [],
    visualModes: collection("visualModes"), characters: collection("characters"),
    locations: collection("locations"), objects: collection("objects"),
  };
}

function emptyItem(key) {
  return Object.fromEntries(Object.entries(contentFields[key]).map(([field, type]) =>
    [field, type === "list" ? [] : type === "boolean" ? false : ""]));
}

function Value({ value }) {
  if (Array.isArray(value)) return value.length
    ? <ul className="list-disc pl-5 space-y-1">{value.map((item, index) => <li key={index} className="whitespace-pre-wrap break-words">{item}</li>)}</ul>
    : <span className="text-slate-500">Не обнаружено</span>;
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return value ? <span className="whitespace-pre-wrap break-words">{value}</span>
    : <span className="text-slate-500">Не обнаружено</span>;
}

function Fields({ value = {}, labels }) {
  return <dl className="space-y-3 text-sm">{Object.entries(labels).map(([key, label]) => (
    <div key={key}><dt className="text-slate-400 mb-1">{label}</dt><dd><Value value={value[key]} /></dd></div>
  ))}</dl>;
}

function EditorFields({ value = {}, labels, onChange }) {
  return <div className="space-y-3 text-sm">{Object.entries(labels).map(([key, label]) => {
    const type = key === "recurring" ? "boolean" : Array.isArray(value[key]) ? "list" : "text";
    if (type === "boolean") return <label key={key} className="flex items-center gap-3 text-slate-300"><input type="checkbox" checked={Boolean(value[key])} onChange={event => onChange(key, event.target.checked)} />{label}</label>;
    return <label key={key} className="block"><span className="block text-slate-400 mb-1">{label}</span>
      {type === "list" ? <textarea className="w-full min-h-24 rounded-lg bg-slate-950 border border-slate-700 p-3" value={listToText(value[key])} onChange={event => onChange(key, textToDraftList(event.target.value))} />
        : key === "name" ? <input className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3" value={value[key] || ""} onChange={event => onChange(key, event.target.value)} />
          : <textarea className="w-full min-h-24 rounded-lg bg-slate-950 border border-slate-700 p-3" value={value[key] || ""} onChange={event => onChange(key, event.target.value)} />}
    </label>;
  })}</div>;
}

function readableError(error) {
  const messages = {
    401: "Сессия завершена. Войдите в приложение снова.",
    403: "Нет доступа к этому проекту.",
    404: "Проект недоступен или удалён.",
    409: "Сценарий или Visual Bible изменились. Обновите данные перед продолжением.",
    400: "Не удалось выполнить запрос. Обновите данные и попробуйте снова.",
    502: "Не удалось получить корректную Visual Bible от ИИ. Попробуйте ещё раз.",
  };
  // Render only diagnostics, never arbitrary provider messages or response bodies.
  const code = typeof error.code === "string" && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : null;
  return {
    message: messages[error.status] || "Не удалось выполнить запрос. Проверьте соединение и попробуйте снова.",
    status: error.status, code,
    fields: code === "INVALID_VISUAL_BIBLE_RESPONSE" && Array.isArray(error.fields)
      ? error.fields.filter(field => typeof field === "string" && /^[\w.$[\]-]{1,100}$/.test(field)) : [],
  };
}

export default function VisualBible() {
  const { projectId } = useParams();
  return <BibleViewer key={projectId} projectId={projectId} />;
}

function BibleViewer({ projectId }) {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState("load");
  const [error, setError] = useState(null);
  const [originalBible, setOriginalBible] = useState(null);
  const [draftBible, setDraftBible] = useState(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    getVisualBible(projectId).then(result => {
      if (active) setData(result);
    }).catch(err => {
      if (active) setError(readableError(err));
    }).finally(() => {
      if (active) setPending(null);
    });
    return () => { active = false; mounted.current = false; };
  }, [projectId]);

  const run = async (action) => {
    if (pending || inFlight.current) return;
    inFlight.current = true;
    setPending(action);
    setError(null);
    try {
      const result = action === "load" ? await getVisualBible(projectId)
        : action === "generate"
          ? await generateVisualBibleDraft(projectId, data.scriptRevision, data.visualBible.editVersion)
          : await confirmVisualBible(projectId, data.visualBible.sourceScriptRevision, data.visualBible.editVersion);
      if (mounted.current) {
        setData(result);
        if (action === "load" && draftBible) setOriginalBible(copyBible(result.visualBible));
      }
    } catch (err) {
      if (mounted.current) setError(readableError(err));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(null);
    }
  };

  const bible = data?.visualBible;
  const scriptConfirmed = data?.scriptStatus === "confirmed";
  const editing = Boolean(draftBible);
  const dirty = editing && JSON.stringify(contentFromBible(draftBible)) !== JSON.stringify(contentFromBible(originalBible));
  const blocked = Boolean(pending) || error?.status === 409 || editing;

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const beginEdit = () => {
    setError(null);
    const snapshot = copyBible(bible);
    setOriginalBible(snapshot);
    setDraftBible(copyBible(snapshot));
  };
  const updateDraft = (updater) => setDraftBible(current => updater(copyBible(current)));
  const updateCollectionItem = (key, index, field, value) => updateDraft(next => {
    next[key][index][field] = value;
    return next;
  });
  const cancelEdit = () => {
    if (pending || (dirty && !window.confirm("Отменить несохранённые изменения?"))) return;
    setDraftBible(null);
    setOriginalBible(null);
    setError(null);
  };
  const saveEdit = async () => {
    if (pending || inFlight.current || !originalBible || !draftBible || error?.status === 409) return;
    inFlight.current = true;
    setPending("save");
    setError(null);
    try {
      await updateVisualBible(projectId, {
        expectedEditVersion: originalBible.editVersion,
        ...contentFromBible(draftBible),
      });
      const result = await getVisualBible(projectId);
      if (mounted.current) {
        setData(result);
        setDraftBible(null);
        setOriginalBible(null);
      }
    } catch (err) {
      if (mounted.current) setError(readableError(err));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(null);
    }
  };
  return (
    <div className="min-h-[calc(100vh-4rem)] text-white p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <nav className="flex flex-wrap gap-4 text-sm text-purple-300">
          <Link to={`/projects/${projectId}`}>← К проекту</Link>
          <Link to={`/projects/${projectId}/script`}>К сценарию</Link>
        </nav>
        <h1 className="text-3xl font-extrabold">Visual Bible</h1>
        {error && <div role="alert" className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 space-y-2">
          <p>{error.message}</p>
          {error.code && <p className="text-sm text-red-300">Код: {error.code}</p>}
          {error.fields.length > 0 && <div className="text-sm"><p>Поля ответа:</p><ul className="list-disc pl-5">{error.fields.map((field, index) => <li key={index}>{field}</li>)}</ul></div>}
          <button className={button} disabled={Boolean(pending)} onClick={() => run("load")}>Обновить данные</button>
        </div>}
        {pending === "load" && <p role="status" className="text-slate-400">Загрузка Visual Bible…</p>}
        {bible && <>
          <section className={panel}>
            <h2 className={`text-xl font-bold ${bible.status === "confirmed" ? "text-emerald-300" : "text-purple-300"}`}>
              {statuses[bible.status] || "Неизвестный статус"}
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-300">
              <div><dt>Редакция Bible (revision)</dt><dd>{bible.revision}</dd></div>
              <div><dt>Версия изменений (editVersion)</dt><dd>{bible.editVersion}</dd></div>
              <div><dt>Исходная редакция сценария</dt><dd>{bible.sourceScriptRevision ?? "Не задана"}</dd></div>
              <div><dt>Текущая редакция сценария</dt><dd>{data.scriptRevision ?? "Не задана"}</dd></div>
              <div><dt>Статус сценария</dt><dd>{data.scriptStatus === "confirmed" ? "Подтверждён" : data.scriptStatus === "draft" ? "Черновик" : "Не создан"}</dd></div>
            </dl>
            {!scriptConfirmed && <p className="text-amber-300">Сначала сохраните и подтвердите сценарий. Затем можно создать Visual Bible. <Link className="underline" to={`/projects/${projectId}/script`}>Перейти к сценарию</Link></p>}
            {bible.status === "stale" && <p className="text-amber-300">Сценарий изменён. Visual Bible нужно пересоздать</p>}
            <div className="space-y-3">
              {bible.status === "draft" && !editing && <button className={button} disabled={Boolean(pending) || error?.status === 409} onClick={beginEdit}>Редактировать</button>}
              {editing && <div className="flex flex-wrap gap-3">
                <button className={button} disabled={Boolean(pending) || error?.status === 409} onClick={saveEdit}>{pending === "save" ? "Сохраняю изменения…" : "Сохранить изменения"}</button>
                <button className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={Boolean(pending)} onClick={cancelEdit}>Отмена</button>
              </div>}
              {!editing && <>
              <button className={button} disabled={blocked || !scriptConfirmed} onClick={() => run("generate")}>
                {pending === "generate" ? "Создаю Visual Bible…" : bible.status === "empty" ? "Создать Visual Bible" : "Пересоздать Visual Bible"}
              </button>
              {bible.status !== "empty" && <p className="text-sm text-amber-300">При пересоздании текущее содержимое Visual Bible будет заменено.</p>}
              {bible.status === "draft" && <button className={`${button} block bg-emerald-700 hover:bg-emerald-600`}
                disabled={blocked || !scriptConfirmed || bible.sourceScriptRevision !== data.scriptRevision} onClick={() => run("confirm")}>
                {pending === "confirm" ? "Подтверждаю…" : "Подтвердить Visual Bible"}
              </button>}
              </>}
            </div>
          </section>
          <section className={panel}><h2 className="text-xl font-bold">Общий визуальный стиль</h2>
            {editing ? <EditorFields value={draftBible.visualStyle} labels={styleLabels} onChange={(key, value) => updateDraft(next => { next.visualStyle[key] = value; return next; })} /> : <Fields value={bible.visualStyle} labels={styleLabels} />}
          </section>
          {sections.map(([key, title, labels], index) => (
            <div key={key} className="space-y-6">
              <section className={panel}>
                <h2 className="text-xl font-bold">{title}</h2>
                {editing && <button className={button} disabled={Boolean(pending)} onClick={() => updateDraft(next => { next[key].push(emptyItem(key)); return next; })}>Добавить</button>}
                {(editing ? draftBible[key] : bible[key])?.length ? (editing ? draftBible[key] : bible[key]).map((item, itemIndex) => (
                  <article key={item.id || itemIndex} className="border border-slate-700 rounded-xl p-4 space-y-3">
                    <h3 className="font-semibold break-words">{item.name || `Без названия ${itemIndex + 1}`}</h3>
                    {editing ? <><EditorFields value={item} labels={{ name: "Название", ...labels }} onChange={(field, value) => updateCollectionItem(key, itemIndex, field, value)} />
                      <button className={`${button} bg-red-700 hover:bg-red-600`} disabled={Boolean(pending)} onClick={() => {
                        if (item.id && !window.confirm("Удалить существующий элемент?")) return;
                        updateDraft(next => { next[key].splice(itemIndex, 1); return next; });
                      }}>Удалить</button></> : <Fields value={item} labels={labels} />}
                  </article>
                )) : <p className="text-slate-500">Не обнаружено</p>}
              </section>
              {index === 0 && <section className={panel}><h2 className="text-xl font-bold">Правила целостности</h2>
                {editing ? <textarea className="w-full min-h-32 rounded-lg bg-slate-950 border border-slate-700 p-3" value={listToText(draftBible.continuityRules)} onChange={event => updateDraft(next => { next.continuityRules = textToDraftList(event.target.value); return next; })} /> : <Value value={bible.continuityRules} />}
              </section>}
            </div>
          ))}
        </>}
      </div>
    </div>
  );
}
