const BASE = `${String(import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '')}/api/projects`;

export function coverStyleUrl(projectId, revision) {
  return `${BASE}/${projectId}/cover/style/image?v=${encodeURIComponent(revision)}`;
}

export function savedCoverUrl(projectId, savedAt) {
  return `${BASE}/${projectId}/cover/image?v=${encodeURIComponent(savedAt || '')}`;
}

export function coverTemplateUrl(projectId, revision, draft = false) {
  return `${BASE}/${projectId}/cover/style/template?v=${encodeURIComponent(revision)}&draft=${draft ? '1' : '0'}`;
}

export async function coverRequest(projectId, suffix, { method = 'GET', body, file, field = 'file', blob = false } = {}) {
  let data = body === undefined ? undefined : JSON.stringify(body);
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
  if (file) { data = new FormData(); data.append(field, file); }
  const response = await fetch(`${BASE}/${projectId}/cover/${suffix}`, { method, credentials: 'include', headers, body: data });
  if (response.ok && blob) return response.blob();
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.error || `Не удалось выполнить запрос (HTTP ${response.status}).`);
  return result;
}

export function coverImageBlob(result) {
  return new Blob([Uint8Array.from(atob(result.imageBase64), char => char.charCodeAt(0))], { type: result.mimeType });
}

export function downloadCoverFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
