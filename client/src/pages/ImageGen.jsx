import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  confirmStoryboard, detailStoryboardFramePrompt, generateStoryboard,
  exportStoryboardFlowPackage, generateStoryboardFrameImage, getStoryboard, getStoryboardFrameImageUrl,
  getStoryboardFramePreviewUrl,
  importStoryboardFlowFrameImage,
  reconcileStoryboardImages, resetStoryboardImages, resetStoryboardPromptDetails, saveStoryboard,
  saveStoryboardFrame,
} from "../services/api";
import { fetchProfiles } from "../services/profileService";

const panel = "bg-slate-900/80 border border-slate-800 rounded-2xl p-5 md:p-6 space-y-4";
const button = "px-4 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed";
const statuses = { empty: "Не создана", draft: "Черновик", confirmed: "Утверждена", stale: "Устарела" };
const DETAIL_REQUEST_INTERVAL_MS = 4_000;
const DETAIL_RATE_LIMIT_RETRIES = 4;
const MAX_FLOW_ENTRIES = 1_000;
const MAX_FLOW_IMAGE_BYTES = 15 * 1024 * 1024;
const FLOW_FRAME_ID_PATTERN = /frame_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const FLOW_IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp)$/i;

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function flowFrameIdFromFilename(value) {
  if (typeof value !== "string" || value.includes("\\") || value.startsWith("/") ||
      value.split("/").includes("..") || !FLOW_IMAGE_EXTENSION_PATTERN.test(value)) return "";
  return value.split("/").pop()?.match(FLOW_FRAME_ID_PATTERN)?.[0] || "";
}

function flowImageMimeType(filename) {
  if (/\.png$/i.test(filename)) return "image/png";
  if (/\.webp$/i.test(filename)) return "image/webp";
  return "image/jpeg";
}

function Drawer({ title, onClose, children, wide = false }) {
  return <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/75 backdrop-blur-sm md:p-6" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-label={title}
      className={`w-full ${wide ? "md:max-w-5xl" : "md:max-w-3xl"} max-h-[92dvh] overflow-hidden bg-slate-900 border border-slate-700 rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col`}
      onMouseDown={event => event.stopPropagation()}>
      <header className="shrink-0 flex items-center justify-between gap-4 px-4 py-3 md:px-6 border-b border-slate-800">
        <h2 className="font-bold text-lg">{title}</h2>
        <button type="button" aria-label="Закрыть" className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-xl" onClick={onClose}>✕</button>
      </header>
      <div className="overflow-y-auto overscroll-contain p-4 md:p-6 space-y-5">{children}</div>
    </section>
  </div>;
}

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
  if (error?.code === "STORYBOARD_DETAIL_RATE_LIMIT") return "Gemini временно ограничил запросы. Нажмите «Продолжить детализацию» позже.";
  if (error?.code === "INVALID_IMAGE_PROFILE") return "Выберите профиль изображения Google Studio.";
  if (error?.code === "IMAGE_PROVIDER_AUTH_FAILED") return "Google Studio отклонил API-ключ или доступ к выбранной модели.";
  if (error?.code === "IMAGE_PROVIDER_RATE_LIMIT") return "Google Studio временно ограничил запросы. Позже нажмите «Продолжить генерацию».";
  if (error?.code?.startsWith("IMAGE_") || error?.code?.startsWith("EMPTY_IMAGE")) return error.message || "Не удалось сгенерировать изображение.";
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
  const [imageProfiles, setImageProfiles] = useState([]);
  const [imageProfileId, setImageProfileId] = useState("");
  const [imageProgress, setImageProgress] = useState(null);
  const [flowImportProgress, setFlowImportProgress] = useState(null);
  const [imageMethod, setImageMethod] = useState("api");
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [openPanel, setOpenPanel] = useState("");
  const [frameMenuOpen, setFrameMenuOpen] = useState(false);
  const [pending, setPending] = useState("load");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const mounted = useRef(true);
  const stopDetail = useRef(false);
  const stopImages = useRef(false);
  const stopFlowImport = useRef(false);

  const applyData = (result) => {
    setData(result);
    setFrames(result.storyboard.frames.map(editableFrame));
    setInstructions(result.storyboard.instructions || "");
    setCurrentFrameIndex(index => Math.max(0, Math.min(index, Math.max(0, result.storyboard.frames.length - 1))));
  };

  useEffect(() => {
    mounted.current = true;
    let active = true;
    Promise.all([getStoryboard(projectId), fetchProfiles()]).then(([result, profiles]) => {
      if (active) {
        setData(result);
        setFrames(result.storyboard.frames.map(editableFrame));
        setInstructions(result.storyboard.instructions || "");
        const available = profiles.filter(profile => profile.type === "image" && profile.provider === "google_studio");
        setImageProfiles(available);
        setImageProfileId((available.find(profile => profile.isDefault) || available[0])?.id || "");
      }
    }).catch(err => { if (active) setError(readableError(err)); })
      .finally(() => { if (active) setPending(""); });
    return () => { active = false; mounted.current = false; stopDetail.current = true; stopImages.current = true; stopFlowImport.current = true; };
  }, [projectId]);

  const storyboard = data?.storyboard;
  const baseline = useMemo(() => storyboard ? JSON.stringify({
    instructions: storyboard.instructions || "",
    frames: storyboard.frames.map(editableFrame),
  }) : "", [storyboard]);
  const dirty = Boolean(storyboard) && JSON.stringify({ instructions, frames }) !== baseline;
  const changedFrameIds = useMemo(() => {
    if (!storyboard || frames.length !== storyboard.frames.length) return [];
    return frames.reduce((changed, frame, index) => {
      if (JSON.stringify(frame) !== JSON.stringify(editableFrame(storyboard.frames[index]))) {
        changed.push(frame.id || `new:${index}`);
      }
      return changed;
    }, []);
  }, [frames, storyboard]);
  const prerequisitesReady = data?.scriptStatus === "confirmed" && data?.voiceoverStatus === "confirmed" && data?.referencePlanStatus === "confirmed";
  const detailStats = useMemo(() => {
    const storedFrames = storyboard?.frames || [];
    const ready = storedFrames.filter(frame => frame.promptDetailStatus === "ready").length;
    const failed = storedFrames.filter(frame => frame.promptDetailStatus === "error").length;
    return { ready, failed, pending: storedFrames.length - ready, total: storedFrames.length };
  }, [storyboard]);
  const imageStats = useMemo(() => {
    const storedFrames = storyboard?.frames || [];
    const ready = storedFrames.filter(frame => frame.image?.status === "ready").length;
    const failed = storedFrames.filter(frame => frame.image?.status === "error").length;
    const generating = storedFrames.filter(frame => frame.image?.status === "generating").length;
    return { ready, failed, generating, pending: storedFrames.length - ready, total: storedFrames.length };
  }, [storyboard]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!openPanel && !frameMenuOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [openPanel, frameMenuOpen]);

  useEffect(() => {
    const handleKeys = event => {
      if (openPanel || frameMenuOpen) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return;
      if (event.key === "ArrowLeft") setCurrentFrameIndex(index => Math.max(0, index - 1));
      if (event.key === "ArrowRight") setCurrentFrameIndex(index => Math.min(frames.length - 1, index + 1));
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [frames.length, frameMenuOpen, openPanel]);

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
        let rateLimitAttempt = 0;
        while (!stopDetail.current) {
          try {
            current = await detailOne(targets[index], current);
            break;
          } catch (err) {
            if (err?.code !== "STORYBOARD_DETAIL_RATE_LIMIT" ||
                rateLimitAttempt >= DETAIL_RATE_LIMIT_RETRIES) throw err;
            rateLimitAttempt += 1;
            const cooldown = Math.min(300_000, Math.max(
              15_000,
              Number(err.retryAfterMs) || 60_000,
            ));
            const deadline = Date.now() + cooldown;
            while (!stopDetail.current && Date.now() < deadline) {
              const seconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
              if (mounted.current) setMessage(
                `Лимит Gemini. Повтор кадра ${index + 1} через ${seconds} сек. Готовый прогресс сохранён.`,
              );
              await wait(Math.min(1_000, Math.max(0, deadline - Date.now())));
            }
          }
        }
        if (stopDetail.current) break;
        if (mounted.current) {
          applyData(current);
          setDetailProgress({ done: index + 1, total: targets.length });
          setMessage(`Детализировано ${index + 1} из ${targets.length}.`);
        }
        if (index < targets.length - 1) await wait(DETAIL_REQUEST_INTERVAL_MS);
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

  const saveActiveFrame = () => {
    if (!activeFrame?.id) return;
    run(`save-frame:${activeFrame.id}`, () => saveStoryboardFrame(projectId, activeFrame.id, {
      frame: activeFrame,
      expectedEditVersion: storyboard.editVersion,
      sourceStoryboardRevision: storyboard.revision,
    }), `Кадр ${currentFrameIndex + 1} сохранён. Остальные кадры и изображения не изменены.`);
  };

  const cancelActiveFrameChanges = () => {
    if (!activeStoredFrame) return;
    setFrames(current => current.map((frame, index) =>
      index === currentFrameIndex ? editableFrame(activeStoredFrame) : frame));
    setError("");
    setMessage(`Изменения кадра ${currentFrameIndex + 1} отменены.`);
  };

  const confirm = () => run("confirm", () => confirmStoryboard(projectId, {
    expectedEditVersion: storyboard.editVersion,
    sourceScriptRevision: storyboard.sourceScriptRevision,
    sourceReferencePlanRevision: storyboard.sourceReferencePlanRevision,
    sourceVoiceoverRevision: storyboard.sourceVoiceoverRevision,
  }), "Раскадровка утверждена.");

  const generateImageOne = (frameId, currentData) => generateStoryboardFrameImage(projectId, frameId, {
    profileId: imageProfileId,
    sourceStoryboardRevision: currentData.storyboard.revision,
  });

  const generateFrameImage = frameId => run(`image:${frameId}`, async () => {
    try {
      return await generateImageOne(frameId, data);
    } catch (generationError) {
      try { applyData(await getStoryboard(projectId)); } catch { /* keep last valid state */ }
      throw generationError;
    }
  }, "Изображение кадра готово.");

  const generateAllImages = async (restart = false) => {
    if (pending || dirty || storyboard?.status !== "confirmed" || !imageProfileId) return;
    stopImages.current = false;
    setPending("image-all"); setError(""); setMessage("");
    let current = data;
    try {
      if (restart) {
        current = await resetStoryboardImages(projectId, {
          sourceStoryboardRevision: current.storyboard.revision,
        });
        if (mounted.current) applyData(current);
      }
      const targets = current.storyboard.frames
        .filter(frame => frame.image?.status !== "ready")
        .map(frame => frame.id);
      if (!targets.length) {
        if (mounted.current) setMessage("Все изображения кадров уже готовы.");
        return;
      }
      setImageProgress({ done: 0, total: targets.length });
      for (let index = 0; index < targets.length; index += 1) {
        if (stopImages.current) break;
        current = await generateImageOne(targets[index], current);
        if (mounted.current) {
          applyData(current);
          setImageProgress({ done: index + 1, total: targets.length });
        }
      }
      if (mounted.current) setMessage(stopImages.current
        ? "Генерация остановлена. Готовые изображения сохранены."
        : "Все изображения кадров сгенерированы.");
    } catch (err) {
      if (mounted.current) {
        setError(readableError(err));
        try { applyData(await getStoryboard(projectId)); } catch { /* keep last valid state */ }
      }
    } finally {
      if (mounted.current) setPending("");
    }
  };

  const downloadBlob = ({ blob, filename }) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportFlow = async (frameId = "") => {
    if (pending) return;
    setPending(frameId ? `flow-export:${frameId}` : "flow-export"); setError(""); setMessage("");
    try {
      downloadBlob(await exportStoryboardFlowPackage(projectId, storyboard.revision, frameId));
      setMessage(frameId
        ? "Пакет кадра для Google Flow скачан."
        : `Пакет Google Flow скачан: кадров без готового изображения — ${imageStats.pending}.`);
    } catch (err) { setError(readableError(err)); }
    finally { setPending(""); }
  };

  const importFlowArchive = async event => {
    const archive = event.target.files?.[0];
    event.target.value = "";
    if (!archive || pending) return;
    stopFlowImport.current = false;
    setPending("flow-import"); setError(""); setMessage("");
    setFlowImportProgress({ done: 0, total: 0, imported: 0, replaced: 0, errors: 0 });
    let zipReader;
    try {
      const { BlobReader, BlobWriter, ZipReader } = await import("@zip.js/zip.js");
      zipReader = new ZipReader(new BlobReader(archive), { strictness: "balanced" });
      const entries = await zipReader.getEntries();
      if (entries.length > MAX_FLOW_ENTRIES) throw new Error(`В архиве слишком много файлов: ${entries.length}. Максимум ${MAX_FLOW_ENTRIES}.`);

      const frameOrder = new Map(storyboard.frames.map((frame, index) => [frame.id, index]));
      const selected = new Map();
      let unknown = 0;
      let duplicates = 0;
      for (const entry of entries) {
        if (entry.directory) continue;
        const frameId = flowFrameIdFromFilename(entry.filename);
        if (!frameId) continue;
        if (!frameOrder.has(frameId)) { unknown += 1; continue; }
        if (selected.has(frameId)) { duplicates += 1; continue; }
        selected.set(frameId, entry);
      }
      const candidates = [...selected.entries()]
        .sort(([left], [right]) => frameOrder.get(left) - frameOrder.get(right));
      if (!candidates.length) throw new Error("В архиве не найдены изображения с frameId в имени файла.");

      const originallyReady = new Set(storyboard.frames
        .filter(frame => frame.image?.status === "ready" && frame.image?.hasImage)
        .map(frame => frame.id));
      const summary = { imported: 0, replaced: 0, errors: 0, unknown, duplicates };
      setFlowImportProgress({ done: 0, total: candidates.length, ...summary });

      for (let index = 0; index < candidates.length; index += 1) {
        if (stopFlowImport.current) break;
        const [frameId, entry] = candidates[index];
        try {
          if (entry.uncompressedSize > MAX_FLOW_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
          const image = await entry.getData(new BlobWriter(flowImageMimeType(entry.filename)), {
            checkSignature: true,
          });
          if (!image || image.size > MAX_FLOW_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");

          let lastError;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              await importStoryboardFlowFrameImage(projectId, frameId, image, storyboard.revision, true);
              lastError = null;
              break;
            } catch (uploadError) {
              lastError = uploadError;
              if ([400, 401, 403, 409, 413].includes(uploadError?.status) || attempt === 2) throw uploadError;
              await wait(2_000 * (attempt + 1));
            }
          }
          if (lastError) throw lastError;
          if (originallyReady.has(frameId)) summary.replaced += 1;
          else summary.imported += 1;
        } catch (entryError) {
          if ([401, 403, 409].includes(entryError?.status)) throw entryError;
          summary.errors += 1;
        }
        if (mounted.current) {
          setFlowImportProgress({ done: index + 1, total: candidates.length, ...summary });
          setMessage(`Импорт Flow: ${index + 1}/${candidates.length}. Добавлено ${summary.imported}, заменено ${summary.replaced}, ошибок ${summary.errors}.`);
        }
      }

      const refreshed = await getStoryboard(projectId);
      if (mounted.current) applyData(refreshed);
      const stopped = stopFlowImport.current ? " Импорт остановлен, уже загруженные файлы сохранены." : "";
      setMessage(`Импорт Flow завершён: добавлено ${summary.imported}; заменено ${summary.replaced}; ошибок ${summary.errors}; неизвестных файлов ${summary.unknown}; дубликатов ${summary.duplicates}.${stopped}`);
    } catch (err) { setError(readableError(err)); }
    finally {
      if (zipReader) await zipReader.close().catch(() => {});
      setPending("");
    }
  };

  const importFlowFrame = async (frameId, event) => {
    const image = event.target.files?.[0];
    event.target.value = "";
    if (!image || pending) return;
    await run(`flow-frame:${frameId}`,
      () => importStoryboardFlowFrameImage(projectId, frameId, image, storyboard.revision),
      "Изображение Google Flow привязано к кадру.");
  };

  const reconcileImages = async () => {
    if (pending || dirty || storyboard?.status !== "confirmed") return;
    setPending("reconcile-images"); setError(""); setMessage("");
    try {
      const result = await reconcileStoryboardImages(projectId, {
        sourceStoryboardRevision: storyboard.revision,
      });
      if (mounted.current) {
        applyData(result);
        const summary = result.reconcileSummary || {};
        setMessage(`Проверка завершена: доступно ${summary.current || 0}, восстановлено ${summary.reattached || 0}, устарело ${summary.stale || 0}, отсутствует ${summary.missing || 0}.`);
      }
    } catch (err) {
      if (mounted.current) setError(readableError(err));
    } finally {
      if (mounted.current) setPending("");
    }
  };

  const copyFramePrompt = async frame => {
    try {
      await navigator.clipboard.writeText(frame.prompt);
      setMessage(`Prompt кадра ${frame.order || ""} скопирован.`);
      setError("");
    } catch { setError("Не удалось скопировать prompt. Разрешите браузеру доступ к буферу обмена."); }
  };

  const updateFrame = (index, field, value) => setFrames(current =>
    current.map((frame, i) => i === index ? { ...frame, [field]: value } : frame));
  const moveFrame = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= frames.length) return;
    setFrames(current => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setCurrentFrameIndex(target);
  };
  const toggleReference = (index, referenceId) => {
    const current = frames[index].referenceIds;
    updateFrame(index, "referenceIds", current.includes(referenceId)
      ? current.filter(id => id !== referenceId) : [...current, referenceId]);
  };
  const goToFrame = index => {
    setFrameMenuOpen(false);
    setCurrentFrameIndex(Math.max(0, Math.min(index, frames.length - 1)));
    requestAnimationFrame(() => document.getElementById("active-storyboard-frame")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const addFrame = () => {
    const newIndex = frames.length;
    setFrames(current => [...current, editableFrame({ sourceVoiceoverBlockId: data.voiceoverBlocks[0]?.id || "" })]);
    setCurrentFrameIndex(newIndex);
  };

  const activeFrame = frames[currentFrameIndex];
  const activeStoredFrame = activeFrame && storyboard?.frames.find(item => item.id === activeFrame.id);
  const activeFrameDirty = Boolean(activeFrame?.id && activeStoredFrame &&
    JSON.stringify(activeFrame) !== JSON.stringify(editableFrame(activeStoredFrame)));
  const frameStructureUnchanged = Boolean(storyboard && frames.length === storyboard.frames.length &&
    frames.every((frame, index) => frame.id === storyboard.frames[index]?.id));
  const canSaveActiveFrame = Boolean(storyboard?.status === "confirmed" && activeFrameDirty &&
    instructions === (storyboard.instructions || "") && frameStructureUnchanged &&
    changedFrameIds.length === 1 && changedFrameIds[0] === activeFrame.id);
  const activeDetailStatus = activeStoredFrame?.promptDetailStatus || "pending";
  const activeImage = activeStoredFrame?.image || { status: "pending", hasImage: false };
  const activeImageStatus = activeFrame && pending === `image:${activeFrame.id}` ? "generating" : activeImage.status;
  const imageStatusLabel = activeImageStatus === "ready" ? "Готово" : activeImageStatus === "error" ? "Ошибка" : activeImageStatus === "generating" ? "Генерируется" : activeImage.stale ? "Требует обновления" : "Ожидает";
  const activePreviewUrl = activeFrame?.id && activeImage.hasImage
    ? getStoryboardFramePreviewUrl(projectId, activeFrame.id, activeImage.updatedAt)
    : "";

  useEffect(() => {
    setImageLoading(Boolean(activePreviewUrl));
    setImageLoadError(false);
  }, [activePreviewUrl]);

  const preloadNextFrame = () => {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection?.saveData || /(?:^|-)2g$/i.test(connection?.effectiveType || "")) return;
    const nextFrame = storyboard?.frames?.[currentFrameIndex + 1];
    if (!nextFrame?.image?.hasImage) return;
    const preload = new Image();
    preload.decoding = "async";
    preload.src = getStoryboardFramePreviewUrl(projectId, nextFrame.id, nextFrame.image.updatedAt);
  };

  if (!data && pending === "load") return <div className="text-white p-8">Загрузка изображений…</div>;

  return <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white px-3 pb-6 md:px-8 md:pb-10">
    <div className="max-w-6xl mx-auto">
      <header className="sticky top-16 z-30 -mx-3 px-3 py-1.5 md:-mx-8 md:px-8 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800 shadow-xl shadow-black/20 space-y-1.5">
        <div className="flex items-center justify-between gap-2 h-8">
          <div className="min-w-0 flex items-center gap-2">
            <Link to={`/projects/${projectId}`} aria-label="К проекту" className="shrink-0 w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center">←</Link>
            <h1 className="font-bold text-sm truncate">Работа с изображениями</h1>
          </div>
          <div className="shrink-0 flex gap-2">
            <button type="button" className="h-8 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs" onClick={() => setOpenPanel("images")}>⚙ <span className="hidden sm:inline">Настройки</span></button>
            <button type="button" className="h-8 px-2.5 rounded-lg bg-purple-700 hover:bg-purple-600 text-xs" onClick={() => setOpenPanel("storyboard")}>☰ <span className="hidden sm:inline">Раскадровка</span></button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs whitespace-nowrap">
          {frames.length > 0 && <div className="shrink-0 flex items-center rounded-full bg-purple-950 border border-purple-800/60 overflow-hidden">
            <button type="button" aria-label="Предыдущий кадр" className="w-7 h-7 hover:bg-purple-800 disabled:opacity-40" disabled={currentFrameIndex === 0} onClick={() => goToFrame(currentFrameIndex - 1)}>‹</button>
            <button type="button" className="h-7 px-2.5 hover:bg-purple-800 font-semibold" onClick={() => setOpenPanel("frames")}>Кадр {currentFrameIndex + 1}/{frames.length}⌄</button>
            <button type="button" aria-label="Следующий кадр" className="w-7 h-7 hover:bg-purple-800 disabled:opacity-40" disabled={currentFrameIndex >= frames.length - 1} onClick={() => goToFrame(currentFrameIndex + 1)}>›</button>
          </div>}
          <span className="px-2.5 py-1 rounded-full bg-slate-800">Раскадровка: <b>{statuses[storyboard?.status] || storyboard?.status}</b></span>
          <span className={`px-2.5 py-1 rounded-full ${detailStats.failed ? "bg-red-950 text-red-300" : "bg-fuchsia-950 text-fuchsia-200"}`}>Промты: <b>{detailStats.ready}/{detailStats.total}</b></span>
          <span className={`px-2.5 py-1 rounded-full ${imageStats.failed ? "bg-red-950 text-red-300" : "bg-emerald-950 text-emerald-200"}`}>Изображения: <b>{imageStats.ready}/{imageStats.total}</b></span>
          {dirty && <span className="px-2.5 py-1 rounded-full bg-amber-950 text-amber-200">Есть изменения</span>}
        </div>

        {error && <div role="alert" className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-red-500/40 bg-red-950 text-red-200 text-sm">
          <span className="min-w-0 max-h-10 overflow-y-auto">{error}</span><button type="button" className="shrink-0" onClick={() => setError("")}>✕</button>
        </div>}
        {message && <div role="status" className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-950 text-emerald-200 text-sm">
          <span className="min-w-0 max-h-10 overflow-y-auto">{message}</span><button type="button" className="shrink-0" onClick={() => setMessage("")}>✕</button>
        </div>}
      </header>

      <main className="pt-3 md:pt-5">
        {!prerequisitesReady && <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 space-y-2">
          <p>Нужны утверждённый текст озвучки и набор референсов.</p>
          <Link className="underline" to={`/projects/${projectId}/references`}>Перейти к референсам</Link>
        </div>}

        {storyboard?.status === "stale" && <div className="mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300">Сценарий или референсы изменились. Откройте управление раскадровкой и создайте её заново.</div>}

        {activeFrame ? <article id="active-storyboard-frame" className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/85 shadow-2xl scroll-mt-36">
          <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h2 className="font-bold">Кадр {currentFrameIndex + 1}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full ${activeImageStatus === "ready" ? "bg-emerald-950 text-emerald-300" : activeImageStatus === "error" ? "bg-red-950 text-red-300" : activeImageStatus === "generating" ? "bg-cyan-950 text-cyan-300" : "bg-slate-800 text-slate-300"}`}>{imageStatusLabel}</span>
              </div>
              <p className="text-xs text-slate-500 truncate">Prompt: {activeDetailStatus === "ready" ? "детализирован" : activeDetailStatus === "error" ? "ошибка детализации" : "ожидает детализации"}</p>
            </div>
            <div className="shrink-0 flex gap-2">
              <button type="button" title={activeImage.status === "ready" ? "Перегенерировать через Google API" : "Сгенерировать через Google API"} aria-label={activeImage.status === "ready" ? "Перегенерировать через Google API" : "Сгенерировать через Google API"}
                className="w-11 h-10 rounded-xl bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 font-bold" disabled={Boolean(pending) || dirty || storyboard.status !== "confirmed" || !imageProfileId || !activeFrame.id}
                onClick={() => generateFrameImage(activeFrame.id)}>{pending === `image:${activeFrame.id}` ? "…" : "✨G"}</button>
              <button type="button" aria-label="Меню кадра" className="w-11 h-10 rounded-xl bg-purple-700 hover:bg-purple-600 text-xl leading-none" onClick={() => setFrameMenuOpen(true)}>•••</button>
            </div>
          </header>

          <div className="grid lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,.75fr)]">
            <div className="relative bg-black/40 min-h-52 lg:min-h-[55vh] flex items-center justify-center overflow-hidden">
              {activeImage.hasImage ? <>
                {imageLoading && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/70 text-slate-300">
                  <span className="w-9 h-9 rounded-full border-4 border-slate-700 border-t-purple-400 animate-spin" />
                  <span className="text-sm">Загрузка изображения…</span>
                </div>}
                {imageLoadError && <div role="alert" className="absolute inset-0 flex items-center justify-center p-6 bg-red-950/40 text-red-200 text-center">Не удалось загрузить изображение. Обновите страницу или войдите через Google заново.</div>}
                <img key={activePreviewUrl} src={activePreviewUrl} alt={`Кадр ${currentFrameIndex + 1}`}
                  loading="eager" decoding="async" fetchPriority="high"
                  onLoad={() => { setImageLoading(false); setImageLoadError(false); preloadNextFrame(); }}
                  onError={() => { setImageLoading(false); setImageLoadError(true); }}
                  className={`w-full max-h-[55vh] object-contain transition-opacity duration-200 ${imageLoading || imageLoadError ? "opacity-0" : "opacity-100"}`} />
              </>
                : <div className="aspect-video w-full flex flex-col items-center justify-center gap-2 text-slate-500 p-6 text-center"><span className="text-4xl">▧</span><p>Изображение ещё не создано</p></div>}
            </div>
            <div className="p-4 md:p-5 flex flex-col gap-4">
              <div className="min-h-0">
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Текст кадра</p>
                <p className="text-base md:text-lg leading-relaxed max-h-32 lg:max-h-[32vh] overflow-y-auto pr-1">{activeFrame.scriptText || "Текст кадра не указан"}</p>
              </div>
              <div className="mt-auto pt-3 border-t border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-400">
                <span>Референсов: {activeFrame.referenceIds.length}</span>
                <button type="button" className="text-purple-300 hover:text-purple-200" onClick={() => setFrameMenuOpen(true)}>Открыть настройки кадра →</button>
              </div>
            </div>
          </div>
        </article> : <section className={`${panel} text-center py-12`}>
          <h2 className="text-xl font-bold">Кадров пока нет</h2>
          <p className="text-slate-400">Откройте управление раскадровкой и запустите создание кадров.</p>
          <button type="button" className={button} onClick={() => setOpenPanel("storyboard")}>Открыть управление</button>
        </section>}
      </main>
    </div>

    {openPanel === "frames" && <Drawer title="Выбор кадра" onClose={() => setOpenPanel("")}>
      <select value={currentFrameIndex} onChange={event => { goToFrame(Number(event.target.value)); setOpenPanel(""); }} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3">
        {frames.map((frame, index) => <option key={frame.id || index} value={index}>Кадр {index + 1} из {frames.length}</option>)}
      </select>
      <div className="grid grid-cols-6 sm:grid-cols-10 gap-2 max-h-[55dvh] overflow-y-auto pr-1">
        {frames.map((frame, index) => {
          const state = storyboard.frames.find(item => item.id === frame.id)?.image?.status || "pending";
          const color = state === "ready" ? "bg-emerald-700" : state === "error" ? "bg-red-800" : state === "generating" ? "bg-cyan-700" : "bg-slate-700";
          return <button key={frame.id || index} type="button" className={`py-2.5 rounded-lg text-sm ${color} ${index === currentFrameIndex ? "ring-2 ring-purple-400" : ""}`} onClick={() => { goToFrame(index); setOpenPanel(""); }}>{index + 1}</button>;
        })}
      </div>
      <p className="text-xs text-slate-500">Зелёный — изображение готово, красный — ошибка, голубой — генерируется.</p>
    </Drawer>}

    {openPanel === "storyboard" && <Drawer title="Управление раскадровкой" wide onClose={() => setOpenPanel("")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">Статус: <span className="text-white font-semibold">{statuses[storyboard.status] || storyboard.status}</span> · кадров {frames.length}</p>
        {dirty && <span className="text-sm text-amber-300">Есть несохранённые изменения</span>}
      </div>
      <label className="block"><span className="block text-sm text-slate-300 mb-2">Общие инструкции для раскадровки</span>
        <textarea value={instructions} maxLength={4000} onChange={event => setInstructions(event.target.value)} placeholder="Например: больше крупных планов, избегай повторяющихся композиций" className="w-full min-h-24 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>
      {frames.length > 0 && <label className="block"><span className="block text-sm text-slate-300 mb-2">Общая инструкция для детализации промтов</span>
        <textarea value={detailInstruction} maxLength={2000} onChange={event => setDetailInstruction(event.target.value)} placeholder="Например: фотореализм, кинематографическое освещение" className="w-full min-h-24 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <button type="button" className={button} disabled={Boolean(pending) || !prerequisitesReady} onClick={generate}>{pending === "generate" ? "ИИ создаёт кадры…" : frames.length ? "Обновить с помощью ИИ" : "Создать раскадровку"}</button>
        {frames.length > 0 && <button type="button" className={`${button} bg-amber-700 hover:bg-amber-600`} disabled={Boolean(pending) || !prerequisitesReady} onClick={generateFromScratch}>{pending === "regenerate" ? "ИИ пересоздаёт…" : "Пересоздать с нуля"}</button>}
        {frames.length > 0 && <button type="button" className={`${button} bg-fuchsia-700 hover:bg-fuchsia-600`} disabled={Boolean(pending) || dirty || !prerequisitesReady || detailStats.pending === 0} onClick={() => detailAll(false)}>{pending === "detail-all" ? "ИИ детализирует…" : "Продолжить детализацию"}</button>}
        {frames.length > 0 && <button type="button" className={`${button} bg-violet-800 hover:bg-violet-700`} disabled={Boolean(pending) || dirty || !prerequisitesReady} onClick={() => { if (window.confirm("Начать детализацию всех промтов заново с первого кадра?")) detailAll(true); }}>Детализировать заново</button>}
        {pending === "detail-all" && <button type="button" className={`${button} bg-red-800 hover:bg-red-700`} onClick={() => { stopDetail.current = true; }}>Остановить детализацию</button>}
        {frames.length > 0 && <button type="button" className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={Boolean(pending) || !dirty || storyboard.status === "stale"} onClick={save}>Сохранить изменения</button>}
        {frames.length > 0 && <button type="button" className={`${button} bg-emerald-700 hover:bg-emerald-600`} disabled={Boolean(pending) || dirty || storyboard.status !== "draft"} onClick={confirm}>Утвердить раскадровку</button>}
      </div>
      {(detailProgress || frames.length > 0) && <p className="text-sm text-slate-400">Детализация: <span className="text-emerald-400">готово {detailStats.ready}/{detailStats.total}</span>{detailStats.failed > 0 && <span className="text-red-400"> · ошибок {detailStats.failed}</span>}{detailProgress && <span className="text-fuchsia-300"> · в запуске {detailProgress.done}/{detailProgress.total}</span>}</p>}
      {frames.length > 0 && <div className="space-y-3 border-t border-slate-800 pt-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Все кадры</h3><button type="button" className="text-sm text-purple-300" disabled={Boolean(pending)} onClick={addFrame}>+ Добавить кадр</button></div>
        <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-14 gap-2 max-h-56 overflow-y-auto pr-1">
          {frames.map((frame, index) => {
            const state = storyboard.frames.find(item => item.id === frame.id)?.image?.status || "pending";
            const color = state === "ready" ? "bg-emerald-700" : state === "error" ? "bg-red-800" : state === "generating" ? "bg-cyan-700" : "bg-slate-700";
            return <button key={frame.id || index} type="button" className={`py-2 rounded-lg text-sm ${color} ${index === currentFrameIndex ? "ring-2 ring-purple-400" : ""}`} onClick={() => { goToFrame(index); setOpenPanel(""); }}>{index + 1}</button>;
          })}
        </div>
        <p className="text-xs text-slate-500">Зелёный — готово, красный — ошибка, голубой — генерируется.</p>
      </div>}
    </Drawer>}

    {openPanel === "images" && <Drawer title="Настройки генерации изображений" onClose={() => setOpenPanel("")}>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={`${button} ${imageMethod === "api" ? "bg-purple-700" : "bg-slate-700 hover:bg-slate-600"}`} disabled={Boolean(pending)} onClick={() => setImageMethod("api")}>Google Studio API</button>
        <button type="button" className={`${button} ${imageMethod === "flow" ? "bg-blue-700" : "bg-slate-700 hover:bg-slate-600"}`} disabled={Boolean(pending)} onClick={() => setImageMethod("flow")}>Google Flow</button>
      </div>
      {storyboard.status !== "confirmed" || dirty ? <p className="p-3 rounded-xl bg-amber-950/40 text-amber-300">Для генерации сохраните изменения и утвердите раскадровку.</p> : null}
      {imageMethod === "api" && <>
        <label className="block"><span className="block text-sm text-slate-300 mb-2">Профиль изображения</span><select value={imageProfileId} onChange={event => setImageProfileId(event.target.value)} disabled={Boolean(pending)} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3"><option value="">Выберите профиль Google Studio</option>{imageProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.isDefault ? " — по умолчанию" : ""}</option>)}</select></label>
        <Link to="/settings" className="inline-block text-sm text-purple-300 hover:text-purple-200">Открыть настройки профилей →</Link>
        {!imageProfiles.length && <p className="text-amber-300">Создайте профиль типа «Изображение» с провайдером Google Studio.</p>}
        <div className="grid sm:grid-cols-2 gap-2">
          <button type="button" className={`${button} bg-cyan-700 hover:bg-cyan-600`} disabled={Boolean(pending) || dirty || storyboard.status !== "confirmed" || !imageProfileId || imageStats.pending === 0} onClick={() => generateAllImages(false)}>{pending === "image-all" ? "Генерация…" : "Продолжить генерацию"}</button>
          <button type="button" className={`${button} bg-blue-800 hover:bg-blue-700`} disabled={Boolean(pending) || dirty || storyboard.status !== "confirmed" || !imageProfileId} onClick={() => { if (window.confirm("Начать генерацию всех изображений заново с первого кадра?")) generateAllImages(true); }}>Начать заново</button>
          {pending === "image-all" && <button type="button" className={`${button} bg-red-800 hover:bg-red-700 sm:col-span-2`} onClick={() => { stopImages.current = true; }}>Остановить после текущего кадра</button>}
        </div>
        {imageProgress && <p className="text-sm text-cyan-300">Обработано в этом запуске: {imageProgress.done}/{imageProgress.total}</p>}
      </>}
      {imageMethod === "flow" && <div className="space-y-4 border border-blue-800/60 bg-blue-950/20 rounded-xl p-4">
        <p className="text-sm text-slate-300">Экспорт включает незавершённые кадры. Большие архивы распаковываются в браузере, а изображения загружаются последовательно без общего серверного лимита ZIP.</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <button type="button" className={`${button} bg-blue-700 hover:bg-blue-600`} disabled={Boolean(pending) || dirty || storyboard.status !== "confirmed" || imageStats.pending === 0} onClick={() => exportFlow()}>{pending === "flow-export" ? "Подготовка ZIP…" : `Экспортировать (${imageStats.pending})`}</button>
          <a href="https://flow.google.com/" target="_blank" rel="noreferrer" className={`${button} bg-slate-700 hover:bg-slate-600 text-center`}>Открыть Google Flow</a>
          <label className={`${button} bg-emerald-700 hover:bg-emerald-600 cursor-pointer text-center sm:col-span-2 ${pending || dirty || storyboard.status !== "confirmed" ? "opacity-50 pointer-events-none" : ""}`}>{pending === "flow-import" ? "Импорт ZIP…" : "Импортировать результаты Flow"}<input type="file" accept=".zip,application/zip" className="hidden" onChange={importFlowArchive} /></label>
          {pending === "flow-import" && <button type="button" className={`${button} bg-red-800 hover:bg-red-700 sm:col-span-2`} onClick={() => { stopFlowImport.current = true; }}>Остановить после текущего файла</button>}
        </div>
        {flowImportProgress && <p className="text-sm text-cyan-300">Импортировано в этом запуске: {flowImportProgress.done}/{flowImportProgress.total} · добавлено {flowImportProgress.imported} · заменено {flowImportProgress.replaced} · ошибок {flowImportProgress.errors}</p>}
      </div>}
      <p className="text-sm text-slate-400">Готово {imageStats.ready}/{imageStats.total}{imageStats.failed > 0 ? ` · ошибок ${imageStats.failed}` : ""}{imageStats.generating > 0 ? ` · генерируется ${imageStats.generating}` : ""}</p>
      <div className="border-t border-slate-800 pt-4 space-y-2">
        <button type="button" className={`${button} w-full bg-slate-700 hover:bg-slate-600`} disabled={Boolean(pending) || dirty || storyboard.status !== "confirmed"} onClick={reconcileImages}>{pending === "reconcile-images" ? "Проверяем привязки…" : "Восстановить привязки изображений"}</button>
        <p className="text-xs text-slate-500">Безопасно проверяет сохранённые изображения и возвращает только те, у которых совпадают кадр, prompt и референсы.</p>
      </div>
    </Drawer>}

    {frameMenuOpen && activeFrame && <Drawer title={`Кадр ${currentFrameIndex + 1} — настройки`} wide onClose={() => setFrameMenuOpen(false)}>
      <div className="flex gap-2">
        <button type="button" className={`${button} flex-1 bg-slate-700 hover:bg-slate-600`} disabled={currentFrameIndex === 0 || Boolean(pending)} onClick={() => moveFrame(currentFrameIndex, -1)}>← Переместить</button>
        <button type="button" className={`${button} flex-1 bg-slate-700 hover:bg-slate-600`} disabled={currentFrameIndex === frames.length - 1 || Boolean(pending)} onClick={() => moveFrame(currentFrameIndex, 1)}>Переместить →</button>
      </div>
      <label className="block"><span className="text-sm text-slate-400">Блок озвучки</span><select value={activeFrame.sourceVoiceoverBlockId} onChange={event => updateFrame(currentFrameIndex, "sourceVoiceoverBlockId", event.target.value)} className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3"><option value="">Выберите блок</option>{data.voiceoverBlocks.map(block => <option key={block.id} value={block.id}>Блок {block.order}: {block.sourceTitle}</option>)}</select></label>
      <label className="block"><span className="text-sm text-slate-400">Точный фрагмент текста озвучки</span><textarea value={activeFrame.scriptText} maxLength={4000} onChange={event => updateFrame(currentFrameIndex, "scriptText", event.target.value)} className="w-full min-h-24 mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>
      <label className="block"><span className="text-sm text-slate-400">Что происходит в кадре</span><textarea value={activeFrame.visualDescription} maxLength={4000} onChange={event => updateFrame(currentFrameIndex, "visualDescription", event.target.value)} className="w-full min-h-28 mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>
      <label className="block"><span className="text-sm text-slate-400">Prompt для изображения</span><textarea value={activeFrame.prompt} maxLength={12000} onChange={event => updateFrame(currentFrameIndex, "prompt", event.target.value)} className="w-full min-h-40 mt-1 bg-slate-950 border border-slate-700 rounded-xl p-3" /></label>
      <div className="flex flex-wrap items-center gap-3"><span className={`text-sm ${activeDetailStatus === "ready" ? "text-emerald-400" : activeDetailStatus === "error" ? "text-red-400" : "text-slate-500"}`}>Детализация: {activeDetailStatus === "ready" ? "готово" : activeDetailStatus === "error" ? "ошибка" : "ожидает"}</span><button type="button" className={`${button} bg-fuchsia-700 hover:bg-fuchsia-600`} disabled={Boolean(pending) || dirty || !prerequisitesReady || !activeFrame.id} onClick={() => detailFrame(activeFrame.id)}>{pending === `detail:${activeFrame.id}` ? "ИИ детализирует…" : "Детализировать prompt"}</button></div>
      <fieldset className="border border-slate-700 rounded-xl p-4 space-y-3"><legend className="px-2 text-sm text-slate-300">Референсы этого кадра</legend>{data.references.length ? <div className="grid sm:grid-cols-2 gap-2">{data.references.map(reference => <label key={reference.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-950/60"><input type="checkbox" checked={activeFrame.referenceIds.includes(reference.id)} onChange={() => toggleReference(currentFrameIndex, reference.id)} /><span><span className="block">{reference.name}</span><span className={`text-xs ${reference.imageReady ? "text-emerald-400" : "text-slate-500"}`}>{reference.imageReady ? "Изображение загружено" : "Только текстовый референс"}</span></span></label>)}</div> : <p className="text-slate-500">Нет выбранных референсов.</p>}</fieldset>
      {activeFrameDirty && <section className="rounded-xl border border-amber-700/60 bg-amber-950/20 p-4 space-y-3">
        <p className="text-sm text-amber-200">Изменения этого кадра ещё не сохранены.</p>
        {!canSaveActiveFrame && <p className="text-xs text-amber-300">Одновременно изменены другие кадры, их порядок или общая инструкция. Для отдельного сохранения сначала отмените эти изменения либо используйте общее сохранение раскадровки.</p>}
        <div className="grid sm:grid-cols-2 gap-2">
          <button type="button" className={`${button} bg-emerald-700 hover:bg-emerald-600`} disabled={Boolean(pending) || !canSaveActiveFrame} onClick={saveActiveFrame}>{pending === `save-frame:${activeFrame.id}` ? "Сохраняем…" : "Сохранить этот кадр"}</button>
          <button type="button" className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={Boolean(pending)} onClick={cancelActiveFrameChanges}>Отменить изменения кадра</button>
        </div>
      </section>}
      {storyboard.status === "confirmed" && !dirty && activeFrame.id && <section className="border border-cyan-800/60 bg-cyan-950/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Изображение кадра</h3><span className="text-sm text-slate-300">{imageStatusLabel}</span></div>
        <div className="flex flex-wrap gap-2">
          {imageMethod === "api" && <button type="button" className={`${button} bg-cyan-700 hover:bg-cyan-600`} disabled={Boolean(pending) || !imageProfileId} onClick={() => generateFrameImage(activeFrame.id)}>{pending === `image:${activeFrame.id}` ? "Генерация…" : activeImage.status === "ready" ? "Перегенерировать" : "Сгенерировать"}</button>}
          {imageMethod === "flow" && <><button type="button" className={`${button} bg-blue-700 hover:bg-blue-600`} disabled={Boolean(pending)} onClick={() => copyFramePrompt({ ...activeFrame, order: currentFrameIndex + 1 })}>Скопировать prompt</button><button type="button" className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={Boolean(pending)} onClick={() => exportFlow(activeFrame.id)}>{pending === `flow-export:${activeFrame.id}` ? "Подготовка…" : "Скачать пакет кадра"}</button><a href="https://flow.google.com/" target="_blank" rel="noreferrer" className={`${button} bg-slate-700 hover:bg-slate-600`}>Открыть Flow</a><label className={`${button} bg-emerald-700 hover:bg-emerald-600 cursor-pointer ${pending ? "opacity-50 pointer-events-none" : ""}`}>{pending === `flow-frame:${activeFrame.id}` ? "Загрузка…" : "Загрузить изображение"}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => importFlowFrame(activeFrame.id, event)} /></label></>}
          {activeImage.hasImage && <a className={`${button} bg-slate-700 hover:bg-slate-600`} href={getStoryboardFrameImageUrl(projectId, activeFrame.id, activeImage.updatedAt, true)}>Скачать</a>}
        </div>
      </section>}
      <div className="flex flex-wrap justify-between gap-2 border-t border-slate-800 pt-4">
        <button type="button" className={`${button} bg-red-800 hover:bg-red-700`} disabled={Boolean(pending)} onClick={() => { if (window.confirm(`Удалить кадр ${currentFrameIndex + 1}?`)) { setFrames(current => current.filter((_, i) => i !== currentFrameIndex)); setCurrentFrameIndex(index => Math.max(0, index - (index === frames.length - 1 ? 1 : 0))); setFrameMenuOpen(false); } }}>Удалить кадр</button>
        <button type="button" className={`${button} bg-slate-700 hover:bg-slate-600`} onClick={() => setFrameMenuOpen(false)}>Закрыть</button>
      </div>
    </Drawer>}
  </div>;
}
