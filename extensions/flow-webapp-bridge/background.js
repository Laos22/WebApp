const FLOW_TOOL_URL = "https://flow.google.com/project/de86267f-f3e0-4767-b161-3e297c3cbe5a/tool/d4ee684e-ea93-4d1e-bbf3-40cf4b35f0dc";
const FLOW_TOOL_PATH = new URL(FLOW_TOOL_URL).pathname;
const LOCAL_ORIGIN = "http://localhost:5173";
const PRODUCTION_ORIGIN = "https://aihub-webapp.onrender.com";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_FLOW_BATCH") {
    handleStart(message.payload, sender).then(sendResponse, error => sendResponse({
      ok: false, error: error?.message || "Не удалось открыть инструмент Google Flow.",
    }));
    return true;
  }

  if (message?.type !== "FLOW_FRAME_RESULT" || !sender.url?.startsWith("https://flow.google.com/")) return;
  handleFrameResult(message.payload).then(sendResponse, error => sendResponse({
    ok: false, error: error?.message || "Не удалось передать кадр в WebApp.",
  }));
  return true;
});

function webAppProject(url, allowedOrigin) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== allowedOrigin) return "";
    return parsed.pathname.match(/^\/projects\/([a-f\d]{24})\/image\/?$/i)?.[1] || "";
  } catch { return ""; }
}

async function handleStart(payload, sender) {
  const origin = new URL(sender.url || "about:blank").origin;
  if ((origin !== LOCAL_ORIGIN && origin !== PRODUCTION_ORIGIN) ||
      webAppProject(sender.url, origin) !== payload?.projectId || !validStartPayload(payload)) {
    return { ok: false, error: "Некорректное задание или страница проекта WebApp." };
  }
  const result = await startFlowBatch(payload);
  if (result?.ok === true && Number.isInteger(sender.tab?.id)) {
    await chrome.storage.session.set({ flowRoute: {
      tabId: sender.tab.id, origin, projectId: payload.projectId,
      storyboardRevision: payload.storyboardRevision,
    } });
  }
  return result;
}

async function handleFrameResult(payload) {
  if (!validPayload(payload)) return { ok: false, error: "Некорректные данные кадра." };
  const { flowRoute } = await chrome.storage.session.get("flowRoute");
  let tab = null;
  if (flowRoute?.projectId === payload.projectId &&
      flowRoute?.storyboardRevision === payload.storyboardRevision &&
      Number.isInteger(flowRoute.tabId)) {
    tab = await chrome.tabs.get(flowRoute.tabId).catch(() => null);
    if (webAppProject(tab?.url, flowRoute.origin) !== payload.projectId) tab = null;
  }
  if (!tab) {
    const patterns = [`${LOCAL_ORIGIN}/projects/*`, `${PRODUCTION_ORIGIN}/projects/*`];
    const tabs = await chrome.tabs.query({ url: patterns });
    const candidates = tabs.filter(item => [LOCAL_ORIGIN, PRODUCTION_ORIGIN].some(origin =>
      origin && webAppProject(item.url, origin) === payload.projectId));
    if (candidates.length > 1) return {
      ok: false, error: "Открыто несколько вкладок этого проекта. Закройте лишнюю и повторите передачу.",
    };
    tab = candidates[0];
  }
  if (!Number.isInteger(tab?.id)) return {
    ok: false, error: "Откройте страницу изображений этого проекта в WebApp.",
  };
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "IMPORT_FLOW_FRAME", payload });
  } catch {
    return { ok: false, error: "Не удалось связаться с WebApp. Обновите вкладку и повторите отправку." };
  }
}

async function startFlowBatch(payload) {
  const tabs = await chrome.tabs.query({ url: "https://flow.google.com/*" });
  let tab = tabs.find(item => {
    try { return new URL(item.url).pathname === FLOW_TOOL_PATH; }
    catch { return false; }
  });
  const created = !tab;
  if (!tab) tab = await chrome.tabs.create({ url: FLOW_TOOL_URL, active: false });
  if (!Number.isInteger(tab?.id)) throw new Error("Не удалось открыть вкладку инструмента Flow.");

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tab.id, {
        type: "START_FLOW_BATCH", requestId: crypto.randomUUID(), payload,
      });
    } catch (error) {
      const noReceiver = /Receiving end does not exist|Could not establish connection/i.test(error?.message || "");
      if (!created || !noReceiver || attempt === 59) {
        throw new Error(created
          ? "Инструмент Flow не открылся. Откройте его и повторите запуск."
          : "Обновите вкладку инструмента Flow после обновления расширения и повторите запуск.");
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error("Инструмент Flow не ответил.");
}

function validPayload(value) {
  return value && typeof value === "object" &&
    /^[a-f\d]{24}$/i.test(value.projectId || "") &&
    Number.isSafeInteger(value.storyboardRevision) && value.storyboardRevision > 0 &&
    /^frame_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.frameId || "") &&
    ["image/png", "image/jpeg", "image/webp"].includes(value.mimeType) &&
    typeof value.base64 === "string" && value.base64.length > 0 && value.base64.length <= 21_000_000;
}

function validStartPayload(value) {
  return value && typeof value === "object" &&
    /^[a-f\d]{24}$/i.test(value.projectId || "") &&
    Number.isSafeInteger(value.storyboardRevision) && value.storyboardRevision > 0 &&
    Number.isSafeInteger(value.batchSize) && value.batchSize >= 1 && value.batchSize <= 20 &&
    ["16:9", "9:16", "1:1"].includes(value.aspectRatio) &&
    ["🍌 Nano Banana 2 Lite", "🍌 Nano Banana 2.1", "🍌 Nano Banana Pro"].includes(value.modelDisplayName) &&
    (!value.frameId || /^frame_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.frameId)) &&
    /^flow-storyboard-r\d+\.zip$/.test(value.filename || "") &&
    typeof value.zipBase64 === "string" && value.zipBase64.length > 0 &&
    value.zipBase64.length <= 24_000_000;
}
