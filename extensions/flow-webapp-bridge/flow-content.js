const TOOL_HOST = /^https:\/\/[a-z0-9.-]+\.usercontent\.goog$/i;
let toolWindow = null;
let toolOrigin = "";
const pendingStarts = new Map();
const pendingVideoStarts = new Map();

function deliverStart(requestId, pending) {
  if (!toolWindow || pending.delivered) return;
  pending.delivered = true;
  try {
    toolWindow.postMessage({
      type: "WEBAPP_FLOW_START_BATCH",
      requestId,
      payload: pending.payload,
    }, toolOrigin);
  } catch {
    pending.finish({ ok: false, error: "Не удалось передать задание инструменту Flow." });
  }
}

function deliverVideoStart(requestId, pending) {
  if (!toolWindow || pending.delivered) return;
  pending.delivered = true;
  try {
    toolWindow.postMessage({ type: "WEBAPP_FLOW_START_VIDEO", requestId, payload: pending.payload }, toolOrigin);
  } catch {
    pending.finish({ ok: false, error: "Не удалось передать видеозадание инструменту Flow." });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "START_FLOW_BATCH") return;
  const { requestId, payload } = message;
  if (typeof requestId !== "string" || !requestId || pendingStarts.size > 0) {
    sendResponse({ ok: false, error: "Инструмент Flow уже принимает задание." });
    return;
  }
  const pending = {
    payload,
    delivered: false,
    finish: result => {
      clearTimeout(pending.timer);
      pendingStarts.delete(requestId);
      sendResponse(result);
    },
  };
  pending.timer = setTimeout(() => pending.finish({
    ok: false, error: "Инструмент Flow не подтвердил приём задания. Обновите его вкладку и повторите запуск.",
  }), 45_000);
  pendingStarts.set(requestId, pending);
  deliverStart(requestId, pending);
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "START_FLOW_VIDEO") return;
  const { requestId, payload } = message;
  if (typeof requestId !== "string" || !requestId || pendingVideoStarts.size > 0) {
    sendResponse({ ok: false, error: "Видеоинструмент Flow уже принимает задание." });
    return;
  }
  const pending = {
    payload,
    delivered: false,
    finish: result => {
      clearTimeout(pending.timer);
      pendingVideoStarts.delete(requestId);
      sendResponse(result);
    },
  };
  pending.timer = setTimeout(() => pending.finish({
    ok: false, error: "Видеоинструмент Flow не подтвердил приём задания. Обновите вкладку и повторите запуск.",
  }), 45_000);
  pendingVideoStarts.set(requestId, pending);
  deliverVideoStart(requestId, pending);
  return true;
});

window.addEventListener("message", event => {
  if (event.source === window || !TOOL_HOST.test(event.origin || "")) return;
  const runner = [...document.querySelectorAll('iframe[src*="/flow-applet-runner/shim.html"]')]
    .find(frame => {
      try { return new URL(frame.src).origin === event.origin; }
      catch { return false; }
    });
  if (!runner) return;
  if (event.data?.type === "WEBAPP_FLOW_TOOL_READY") {
    toolWindow = event.source;
    toolOrigin = event.origin;
    for (const [requestId, pending] of pendingStarts) deliverStart(requestId, pending);
    return;
  }
  if (event.data?.type === "WEBAPP_FLOW_VIDEO_TOOL_READY") {
    toolWindow = event.source;
    toolOrigin = event.origin;
    for (const [requestId, pending] of pendingVideoStarts) deliverVideoStart(requestId, pending);
    return;
  }
  if (event.data?.type === "WEBAPP_FLOW_START_VIDEO_ACK") {
    const pending = pendingVideoStarts.get(event.data.requestId);
    if (!pending || event.source !== toolWindow) return;
    const ack = event.data.payload || event.data;
    pending.finish({ ok: ack.ok === true, error: ack.error || "" });
    return;
  }
  if (event.data?.type === "WEBAPP_FLOW_VIDEO_RESULT" && event.source === toolWindow &&
      typeof event.data.requestId === "string" && event.data.requestId.length > 0 && event.data.requestId.length <= 100) {
    const source = event.data.payload || {};
    const payload = {
      projectId: source.projectId, frameId: source.frameId,
      inputFingerprint: source.inputFingerprint, mimeType: source.mimeType,
      base64: source.base64,
    };
    chrome.runtime.sendMessage({ type: "FLOW_VIDEO_RESULT", payload }, response => {
      const result = { ok: Boolean(response?.ok), error: response?.error || "" };
      event.source.postMessage({ type: "WEBAPP_FLOW_VIDEO_ACK", requestId: event.data.requestId,
        ...result, payload: result }, event.origin);
    });
    return;
  }
  if (event.data?.type === "WEBAPP_FLOW_START_ACK") {
    const pending = pendingStarts.get(event.data.requestId);
    if (!pending || event.source !== toolWindow) return;
    const ack = event.data.payload || event.data;
    pending.finish({ ok: ack.ok === true, error: ack.error || "" });
    return;
  }
  if (event.data?.type !== "WEBAPP_FLOW_FRAME_RESULT" ||
      typeof event.data.requestId !== "string" || !event.data.requestId || event.data.requestId.length > 100) return;

  const source = event.data.payload || {};
  const payload = {
    projectId: source.projectId,
    storyboardRevision: source.storyboardRevision,
    frameId: source.frameId,
    mimeType: source.mimeType || source.resultMimeType,
    base64: source.base64 || source.resultBase64
  };
  chrome.runtime.sendMessage({ type: "FLOW_FRAME_RESULT", payload }, response => {
    const result = {
      ok: Boolean(response?.ok),
      error: response?.error || ""
    };
    event.source.postMessage({
      type: "WEBAPP_FLOW_FRAME_ACK",
      requestId: event.data.requestId,
      ...result,
      payload: result
    }, event.origin);
  });
});
