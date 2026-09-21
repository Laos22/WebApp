import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { downloadDavinciXml, getDavinciStatus } from "../services/api";

const button = "px-4 py-2.5 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed";

export default function DavinciExport() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [frameRate, setFrameRate] = useState(24);
  const [charsPerSecond, setCharsPerSecond] = useState(15);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    getDavinciStatus(projectId)
      .then(result => active && setData(result))
      .catch(err => active && setError(err.message))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [projectId]);

  const download = async () => {
    if (busy || !data?.canExport) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await downloadDavinciXml(projectId, { frameRate, charsPerSecond });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = result.filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      URL.revokeObjectURL(url);
      setMessage("XML подготовлен, сохранён в папке проекта и скачан.");
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
        <p className="text-slate-400 mt-2">Подготовка переносимого FCPXML 1.9 из готовой озвучки и изображений.</p>
      </header>

      {error && <div role="alert" className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{error}</div>}
      {message && <div role="status" className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{message}</div>}

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 space-y-5">
        <div><h2 className="text-xl font-bold">Готовность проекта</h2><p className="text-sm text-slate-400">{data?.projectName || "Загрузка…"}</p></div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="p-4 bg-slate-950 rounded-xl"><span className="text-xs text-slate-500">Раскадровка</span><p className={data?.storyboardReady ? "text-emerald-400" : "text-amber-300"}>{data?.storyboardReady ? "Актуальна" : "Требует обновления"}</p></div>
          <div className="p-4 bg-slate-950 rounded-xl"><span className="text-xs text-slate-500">Изображения</span><p>{data ? `${data.readyImages}/${data.frames}` : "—"}</p></div>
          <div className="p-4 bg-slate-950 rounded-xl"><span className="text-xs text-slate-500">Аудиоблоки</span><p>{data ? `${data.readyAudio}/${data.audioBlocks}` : "—"}</p></div>
        </div>
        {data && !data.canExport && <p className="text-amber-300">Для экспорта нужны актуальная утверждённая раскадровка, все изображения и MP3-блоки.</p>}
      </section>

      <section className="bg-slate-900 border border-cyan-800/40 rounded-2xl p-5 md:p-6 space-y-5">
        <h2 className="text-xl font-bold">Настройки первой версии</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <label><span className="block text-sm text-slate-300 mb-2">Частота кадров</span><select value={frameRate} onChange={event => setFrameRate(Number(event.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3"><option value={24}>24 FPS</option><option value={25}>25 FPS</option><option value={30}>30 FPS</option></select></label>
          <label><span className="block text-sm text-slate-300 mb-2">Оценка скорости речи</span><input type="number" min="5" max="30" step="0.5" value={charsPerSecond} onChange={event => setCharsPerSecond(Number(event.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3" /><span className="block text-xs text-slate-500 mt-1">Символов в секунду</span></label>
        </div>
        <div className="p-4 rounded-xl bg-blue-950/30 border border-blue-800/40 text-sm text-blue-200 space-y-2">
          <p>XML использует относительные пути: <code>images/frame_1_1.jpg</code> и <code>audio/audio_block_1.mp3</code>.</p>
          <p>На этом этапе длительность блоков оценивается по тексту. Точную длительность MP3 и анимации кадров доработаем отдельно в VS Code.</p>
        </div>
        <button type="button" className={`${button} w-full bg-cyan-700 hover:bg-cyan-600`} disabled={busy || !data?.canExport} onClick={download}>{busy ? "Подготовка…" : "Подготовить и скачать XML"}</button>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-sm text-slate-300 space-y-2">
        <h2 className="font-bold text-white">Импорт в DaVinci Resolve</h2>
        <p>Скачайте папку проекта с Google Drive целиком, чтобы рядом с XML находились папки <code>images</code> и <code>audio</code>.</p>
        <p>В Resolve откройте <b>File → Import → Timeline</b> и выберите файл <code>.fcpxml</code>.</p>
      </section>
    </main>
  </div>;
}
