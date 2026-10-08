const pending = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "IMPORT_FLOW_FRAME" && message?.type !== "IMPORT_FLOW_VIDEO") return;
  const requestId = crypto.randomUUID();
  const timeout = setTimeout(() => {
    pending.delete(requestId);
    sendResponse({ ok: false, error: "WebApp не завершил импорт вовремя." });
  }, 120_000);
  pending.set(requestId, response => {
    clearTimeout(timeout);
    sendResponse(response);
  });
  window.postMessage({
    source: "flow-webapp-bridge-extension",
    type: message.type,
    requestId,
    payload: message.payload
  }, location.origin);
  return true;
});

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin ||
      event.data?.source !== "webapp-flow-bridge" || event.data?.type !== "IMPORT_RESULT") return;
  const complete = pending.get(event.data.requestId);
  if (!complete) return;
  pending.delete(event.data.requestId);
  complete({ ok: Boolean(event.data.ok), error: event.data.error || "" });
});

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin ||
      event.data?.source !== "webapp-flow-bridge" ||
      !["START_FLOW_BATCH", "START_FLOW_VIDEO"].includes(event.data?.type) ||
      typeof event.data.requestId !== "string" || !event.data.requestId) return;
  const { requestId, payload } = event.data;
  const video = event.data.type === "START_FLOW_VIDEO";
  chrome.runtime.sendMessage({ type: event.data.type, payload }, response => {
    const error = chrome.runtime.lastError;
    window.postMessage({
      source: "flow-webapp-bridge-extension",
      type: video ? "START_FLOW_VIDEO_RESULT" : "START_FLOW_BATCH_RESULT",
      requestId,
      ok: !error && response?.ok === true,
      error: error ? "Расширение не смогло связаться с Google Flow." : response?.error || "",
    }, location.origin);
  });
});

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin ||
      event.data?.source !== "webapp-flow-bridge" ||
      event.data?.type !== "FLOW_BRIDGE_PING" ||
      typeof event.data.requestId !== "string") return;
  window.postMessage({
    source: "flow-webapp-bridge-extension",
    type: "FLOW_BRIDGE_PING_RESULT",
    requestId: event.data.requestId,
    ok: true,
  }, location.origin);
});
