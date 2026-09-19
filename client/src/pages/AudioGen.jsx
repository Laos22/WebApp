import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  adaptVoiceover, confirmVoiceover, generateVoiceoverBlock, getVoiceover,
  getVoiceoverAudioUrl, saveVoiceover,
} from "../services/api";
import { fetchProfiles } from "../services/profileService";
import { getElevenLabsCharacterLimit } from "../utils/aiProfileConstants";

const button = "px-4 py-2.5 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
const statusLabel = {
  pending: "Не озвучен", ready: "Готов", stale: "Требует перегенерации", error: "Ошибка",
};

export default function AudioGen() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [instructions, setInstructions] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState("");
  const [mode, setMode] = useState("overview");
  const [busy, setBusy] = useState("");
  const [batchProgress, setBatchProgress] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const stopBatch = useRef(false);

  const applyResponse = (response) => {
    setData(response);
    setBlocks(response.voiceover.blocks);
    setInstructions(response.voiceover.instructions || "");
    return response;
  };

  useEffect(() => {
    let active = true;
    Promise.all([getVoiceover(projectId), fetchProfiles()]).then(([voiceover, allProfiles]) => {
      if (!active) return;
      applyResponse(voiceover);
      const audioProfiles = allProfiles.filter(profile => profile.type === "audio" && profile.provider === "elevenlabs");
      setProfiles(audioProfiles);
      setProfileId((audioProfiles.find(profile => profile.isDefault) || audioProfiles[0])?.id || "");
    }).catch(err => active && setError(err.message)).finally(() => active && setBusy(""));
    return () => { active = false; stopBatch.current = true; };
  }, [projectId]);

  const stored = data?.voiceover;
  const dirty = Boolean(stored && (
    instructions !== (stored.instructions || "") ||
    blocks.some((block, index) => block.adaptedText !== stored.blocks[index]?.adaptedText)
  ));
  const blockDirty = Boolean(stored && blocks.some((block, index) =>
    block.adaptedText !== stored.blocks[index]?.adaptedText));
  const readyCount = useMemo(() => blocks.filter(block => block.audioStatus === "ready").length, [blocks]);
  const selectedProfile = profiles.find(profile => profile.id === profileId);
  const selectedModelId = selectedProfile?.audioSettings?.modelId || "eleven_v3";
  const characterLimit = getElevenLabsCharacterLimit(selectedModelId);
  const oversizedBlocks = characterLimit
    ? blocks.filter(block => block.adaptedText.trim().length > characterLimit)
    : [];

  const run = async (name, action) => {
    if (busy) return null;
    setBusy(name); setError(""); setMessage("");
    try { return await action(); }
    catch (err) { setError(err.message); return null; }
    finally { setBusy(""); }
  };

  const handleAdapt = () => run("adapt", async () => {
    const response = await adaptVoiceover(projectId, {
      instructions, expectedEditVersion: stored?.editVersion || 0,
      sourceScriptRevision: data.scriptRevision,
    });
    applyResponse(response);
    setMessage(`Текст адаптирован: ${response.voiceover.blocks.length} блоков.`);
  });

  const handleSave = () => run("save", async () => {
    const response = await saveVoiceover(projectId, {
      instructions, expectedEditVersion: stored.editVersion,
      blocks: blocks.map(block => ({ id: block.id, adaptedText: block.adaptedText })),
    });
    applyResponse(response);
    setMessage("Изменения блоков сохранены.");
  });

  const handleConfirm = () => run("confirm", async () => {
    const response = await confirmVoiceover(projectId, {
      expectedEditVersion: stored.editVersion,
      sourceScriptRevision: stored.sourceScriptRevision,
    });
    applyResponse(response);
    setMessage("Текст для озвучки утверждён.");
  });

  const generateOne = async (blockId, currentData = data) => {
    const block = currentData.voiceover.blocks.find(item => item.id === blockId);
    const response = await generateVoiceoverBlock(projectId, blockId, {
      expectedEditVersion: currentData.voiceover.editVersion,
      textRevision: block.textRevision, profileId,
    });
    return applyResponse(response);
  };

  const handleGenerateOne = (blockId) => run(blockId, async () => {
    const response = await generateOne(blockId);
    setMessage(`Блок ${response.voiceover.blocks.find(item => item.id === blockId)?.order} озвучен.`);
  });

  const handleGenerateAll = async () => {
    if (busy || dirty || !profileId) return;
    stopBatch.current = false;
    setBusy("batch"); setError(""); setMessage("");
    let current = data;
    const pending = current.voiceover.blocks.filter(block => block.audioStatus !== "ready");
    setBatchProgress({ done: 0, total: pending.length });
    try {
      for (let index = 0; index < pending.length; index += 1) {
        if (stopBatch.current) break;
        current = await generateOne(pending[index].id, current);
        setBatchProgress({ done: index + 1, total: pending.length });
      }
      setMessage(stopBatch.current ? "Массовая генерация остановлена." : "Все блоки озвучены.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  if (!data) return <div className="text-white p-12">{error || "Загрузка озвучки..."}</div>;
  const scriptReady = data.scriptStatus === "confirmed";
  const voiceoverReady = stored.status !== "empty" && stored.status !== "stale";

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to={`/projects/${projectId}`} className="text-indigo-400 hover:text-indigo-300 text-sm">&larr; Назад к проекту</Link>
            <h1 className="text-3xl font-extrabold mt-2">Озвучка 🎙️</h1>
            <p className="text-slate-400 mt-1">Адаптация сценарных блоков и генерация отдельных MP3 через ElevenLabs.</p>
          </div>
          <Link to="/settings" className={`${button} bg-slate-800 hover:bg-slate-700`}>Настройки ElevenLabs</Link>
        </div>

        {!scriptReady && <div className="p-5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200">
          Сначала подтвердите сценарий. <Link className="underline" to={`/projects/${projectId}/script`}>Перейти к сценарию</Link>
        </div>}
        {stored.status === "stale" && <div className="p-5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200">Сценарий изменился. Выполните адаптацию заново.</div>}
        {error && <div role="alert" className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300">{error}</div>}
        {message && <div role="status" className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300">{message}</div>}

        <section className="bg-slate-900 border border-indigo-500/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="text-xl font-bold">1. Адаптация текста</h2><p className="text-sm text-slate-400">Количество блоков будет точно таким же, как в утверждённом сценарии.</p></div>
            {stored.status !== "empty" && <span className="text-sm text-slate-400">Редакция {stored.revision} · {blocks.length} блоков</span>}
          </div>
          <textarea rows={3} maxLength={4000} value={instructions} disabled={Boolean(busy)} onChange={event => setInstructions(event.target.value)}
            placeholder="Дополнительные пожелания: темп, паузы, интонации, произношение..." className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4" />
          <div className="flex flex-wrap gap-3">
            <button className={`${button} bg-indigo-700 hover:bg-indigo-600`} disabled={!scriptReady || Boolean(busy) || blockDirty} onClick={handleAdapt}>
              {busy === "adapt" ? "Адаптирую…" : stored.status === "empty" ? "Адаптировать текст" : "Повторить адаптацию"}
            </button>
            {voiceoverReady && <button className={`${button} bg-emerald-700 hover:bg-emerald-600`} disabled={!dirty || Boolean(busy)} onClick={handleSave}>Сохранить изменения</button>}
            {voiceoverReady && stored.status !== "confirmed" && <button className={`${button} bg-teal-700 hover:bg-teal-600`} disabled={dirty || Boolean(busy)} onClick={handleConfirm}>Утвердить текст</button>}
          </div>
          {dirty && <p className="text-sm text-amber-300">Есть несохранённые изменения. Сохраните их перед генерацией аудио.</p>}
        </section>

        {voiceoverReady && <>
          <section className="bg-slate-900 border border-indigo-500/20 rounded-2xl p-6 space-y-4">
            <div className="flex flex-wrap justify-between gap-4">
              <div><h2 className="text-xl font-bold">2. Генерация озвучки</h2><p className="text-sm text-slate-400">Готово {readyCount} из {blocks.length} отдельных аудиофайлов.</p></div>
              <div className="flex gap-2">
                <button className={`${button} ${mode === "overview" ? "bg-indigo-700" : "bg-slate-800"}`} onClick={() => setMode("overview")}>Все блоки</button>
                <button className={`${button} ${mode === "blocks" ? "bg-indigo-700" : "bg-slate-800"}`} onClick={() => setMode("blocks")}>Работа по блокам</button>
              </div>
            </div>

            <div className="grid md:grid-cols-[1fr_auto] gap-4 items-end">
              <div><label className="block text-sm text-slate-300 mb-2">Профиль ElevenLabs</label>
                <select value={profileId} onChange={event => setProfileId(event.target.value)} disabled={Boolean(busy)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3">
                  {!profiles.length && <option value="">Профиль не создан</option>}
                  {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.isDefault ? " — по умолчанию" : ""}</option>)}
                </select></div>
              {!profiles.length && <Link to="/settings" className={`${button} bg-purple-700 hover:bg-purple-600 text-center`}>Создать профиль</Link>}
            </div>
            {profileId && <p className="text-sm text-slate-400">
              Модель: <span className="text-slate-200">{selectedModelId}</span>
              {characterLimit ? ` · лимит одного блока: ${characterLimit.toLocaleString("ru-RU")} символов` : ""}
            </p>}
            {oversizedBlocks.length > 0 && <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200">
              {oversizedBlocks.length === 1 ? `Блок ${oversizedBlocks[0].order} превышает` : `Блоки ${oversizedBlocks.map(block => block.order).join(", ")} превышают`} лимит модели {selectedModelId}. Сократите текст или выберите в настройках профиль с моделью Multilingual v2 / Flash v2.5.
            </div>}

            {mode === "overview" && <div className="p-5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-4">
              <p className="text-slate-300">Будет создан отдельный MP3 для каждого неготового блока. Уже готовые блоки будут пропущены.</p>
              <div className="flex flex-wrap gap-3">
                <button className={`${button} bg-indigo-700 hover:bg-indigo-600`} disabled={Boolean(busy) || dirty || !profileId || readyCount === blocks.length || oversizedBlocks.length > 0} onClick={handleGenerateAll}>Сгенерировать всю озвучку</button>
                {busy === "batch" && <button className={`${button} bg-red-800 hover:bg-red-700`} onClick={() => { stopBatch.current = true; }}>Остановить генерацию</button>}
                <button className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={Boolean(busy)} onClick={() => setMode("blocks")}>Открыть блоки</button>
              </div>
              {batchProgress && <p className="text-sm text-indigo-300">Обработано: {batchProgress.done}/{batchProgress.total}</p>}
            </div>}

            {mode === "blocks" && <div className="space-y-4">
              {blocks.map((block, index) => {
                const changed = block.adaptedText !== stored.blocks[index]?.adaptedText;
                const generating = busy === block.id;
                const blockLength = block.adaptedText.trim().length;
                const exceedsLimit = Boolean(characterLimit && blockLength > characterLimit);
                return <article key={block.id} className="p-5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <div><h3 className="font-bold">Блок {block.order}: {block.sourceTitle.replace(/^Блок\s+\d+\s*/iu, "")}</h3>
                      <span className={`text-xs ${block.audioStatus === "ready" ? "text-emerald-400" : block.audioStatus === "stale" ? "text-amber-300" : "text-slate-400"}`}>{changed ? "Есть несохранённые изменения" : statusLabel[block.audioStatus]}</span></div>
                    <details className="text-sm text-slate-400 max-w-full"><summary className="cursor-pointer">Исходный текст</summary><p className="mt-2 whitespace-pre-wrap max-w-2xl">{block.sourceText}</p></details>
                  </div>
                  <textarea rows={8} value={block.adaptedText} disabled={Boolean(busy)} onChange={event => setBlocks(current => current.map(item => item.id === block.id ? { ...item, adaptedText: event.target.value } : item))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4" />
                  <p className={`text-xs ${exceedsLimit ? "text-amber-300" : "text-slate-500"}`}>
                    {blockLength.toLocaleString("ru-RU")}{characterLimit ? ` / ${characterLimit.toLocaleString("ru-RU")}` : ""} символов
                    {exceedsLimit ? " — превышен лимит выбранной модели" : ""}
                  </p>
                  <div className="flex flex-wrap gap-3 items-center">
                    <button className={`${button} bg-indigo-700 hover:bg-indigo-600`} disabled={Boolean(busy) || dirty || !profileId || exceedsLimit} onClick={() => handleGenerateOne(block.id)}>
                      {generating ? "Генерирую…" : block.audioStatus === "ready" ? "Перегенерировать блок" : "Сгенерировать блок"}
                    </button>
                    {block.audioStatus === "ready" && <>
                      <audio controls preload="none" src={getVoiceoverAudioUrl(projectId, block.id, block.audioGeneratedAt)} className="h-10 max-w-full" />
                      <a className="text-indigo-300 hover:text-indigo-200" href={getVoiceoverAudioUrl(projectId, block.id, block.audioGeneratedAt)} download={`audio_block_${block.order}.mp3`}>Скачать MP3</a>
                    </>}
                  </div>
                </article>;
              })}
            </div>}
          </section>

          {stored.status === "confirmed" && <div className="flex flex-wrap gap-3">
            <Link to={`/projects/${projectId}/references`} className={`${button} bg-fuchsia-700 hover:bg-fuchsia-600`}>Работа с референсами</Link>
          </div>}
        </>}
      </div>
    </div>
  );
}
