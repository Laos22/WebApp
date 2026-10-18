const pending = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["IMPORT_FLOW_FRAME", "IMPORT_FLOW_REFERENCE", "IMPORT_FLOW_VIDEO", "IMPORT_DAVINCI_VIDEO"].includes(message?.type)) return;
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
      !["START_FLOW_BATCH", "START_FLOW_VIDEO", "START_DAVINCI_VIDEO"].includes(event.data?.type) ||
      typeof event.data.requestId !== "string" || !event.data.requestId) return;
  const { requestId, payload } = event.data;
  const video = event.data.type !== "START_FLOW_BATCH";
  chrome.runtime.sendMessage({ type: event.data.type, payload }, response => {
    const error = chrome.runtime.lastError;
    window.postMessage({
      source: "flow-webapp-bridge-extension",
      type: video ? `${event.data.type}_RESULT` : "START_FLOW_BATCH_RESULT",
      requestId,
      ok: !error && response?.ok === true,
      error: error ? "Расширение не смогло связаться с сервисом генерации." : response?.error || "",
    }, location.origin);
  });
});

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin ||
      event.data?.source !== "webapp-flow-bridge" ||
      !["FLOW_BRIDGE_PING", "DAVINCI_BRIDGE_PING"].includes(event.data?.type) ||
      typeof event.data.requestId !== "string") return;
  window.postMessage({
    source: "flow-webapp-bridge-extension",
    type: `${event.data.type}_RESULT`,
    requestId: event.data.requestId,
    ok: true,
    version: chrome.runtime.getManifest().version,
  }, location.origin);
});
