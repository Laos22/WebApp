const API_BASE_URL = "http://localhost:5001/api";

/**
 * Универсальная функция для отправки запроса генерации на бэкенд
 * @param {Object} payload - Данные запроса (prompt, type, style и т.д.)
 */
export async function generateContent(payload) {

  try {
    const response = await fetch(`${API_BASE_URL}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ошибка при генерации контента на сервере");
    }

    return data;
  } catch (error) {
    console.error("API Error:", error);
    throw error;
  }
}

// Project workflow requests use the same server and session as the existing pages.
async function projectRequest(projectId, suffix = "", method = "GET", body) {
  const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/api/projects/${projectId}${suffix}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    const error = new Error(data.error || "Ошибка запроса проекта");
    error.status = response.status;
    error.code = data.code;
    error.fields = data.fields;
    throw error;
  }
  return data;
}

export const getProject = (id) => projectRequest(id);
export const getVisualBible = (projectId) => projectRequest(projectId, "/visual-bible");
export const updateVisualBible = (projectId, payload) =>
  projectRequest(projectId, "/visual-bible", "PUT", payload);
export const editVisualBiblePreview = (projectId, instruction, expectedEditVersion, sourceScriptRevision) =>
  projectRequest(projectId, "/visual-bible/edit", "POST", { instruction, expectedEditVersion, sourceScriptRevision });
export const generateVisualBibleDraft = (projectId, sourceScriptRevision, expectedEditVersion) =>
  projectRequest(projectId, "/visual-bible/draft", "POST", { sourceScriptRevision, expectedEditVersion });
export const confirmVisualBible = (projectId, sourceScriptRevision, expectedEditVersion) =>
  projectRequest(projectId, "/visual-bible/confirm", "POST", { sourceScriptRevision, expectedEditVersion });
export const generateProjectScript = (id, payload) => projectRequest(id, "/generate-script", "POST", payload);
export const saveProjectScript = (id, content, revision) => projectRequest(id, "/script", "PUT", { content, revision });
export const confirmProjectScript = (id, revision) => projectRequest(id, "/script/confirm", "POST", { revision });
export const getVoiceover = (projectId) => projectRequest(projectId, "/voiceover");
export const adaptVoiceover = (projectId, payload) =>
  projectRequest(projectId, "/voiceover/adapt", "POST", payload);
export const saveVoiceover = (projectId, payload) =>
  projectRequest(projectId, "/voiceover", "PUT", payload);
export const confirmVoiceover = (projectId, payload) =>
  projectRequest(projectId, "/voiceover/confirm", "POST", payload);
export const generateVoiceoverBlock = (projectId, blockId, payload) =>
  projectRequest(projectId, `/voiceover/blocks/${encodeURIComponent(blockId)}/generate`, "POST", payload);
export const getVoiceoverAudioUrl = (projectId, blockId, generatedAt) =>
  `${import.meta.env.VITE_SERVER_URL}/api/projects/${projectId}/voiceover/blocks/${encodeURIComponent(blockId)}/audio?v=${encodeURIComponent(generatedAt || "0")}`;
export const getReferencePlan = (projectId) => projectRequest(projectId, "/reference-plan");
export const analyzeReferencePlan = (projectId, payload) =>
  projectRequest(projectId, "/reference-plan/analyze", "POST", payload);
export const saveReferencePlan = (projectId, payload) =>
  projectRequest(projectId, "/reference-plan", "PUT", payload);
export const confirmReferencePlan = (projectId, payload) =>
  projectRequest(projectId, "/reference-plan/confirm", "POST", payload);
export const detailReferencePrompt = (projectId, referenceId, payload) =>
  projectRequest(projectId, `/reference-plan/${encodeURIComponent(referenceId)}/detail-prompt`, "POST", payload);

export async function uploadVisualReference(projectId, referenceId, { file, prompt, sourceReferenceVersion }) {
  const form = new FormData();
  form.append("image", file);
  form.append("prompt", prompt);
  form.append("sourceReferenceVersion", String(sourceReferenceVersion));
  const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/api/projects/${projectId}/visual-references/${encodeURIComponent(referenceId)}/upload`, {
    method: "POST", credentials: "include", body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const error = new Error(data.error || "Не удалось загрузить изображение");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export const deleteVisualReference = (projectId, referenceId) =>
  projectRequest(projectId, `/visual-references/${encodeURIComponent(referenceId)}`, "DELETE");
export const getVisualReferenceImageUrl = (projectId, imageId, updatedAt) =>
  `${import.meta.env.VITE_SERVER_URL}/api/projects/${projectId}/visual-references/${encodeURIComponent(imageId)}/image?v=${encodeURIComponent(updatedAt || "0")}`;
export const getStoryboard = (projectId) => projectRequest(projectId, "/storyboard");
export const generateStoryboard = (projectId, payload) =>
  projectRequest(projectId, "/storyboard/generate", "POST", payload);
export const detailStoryboardFramePrompt = (projectId, frameId, payload) =>
  projectRequest(projectId, `/storyboard/frames/${encodeURIComponent(frameId)}/detail-prompt`, "POST", payload);
export const resetStoryboardPromptDetails = (projectId, payload) =>
  projectRequest(projectId, "/storyboard/detail-prompts/reset", "POST", payload);
export const saveStoryboard = (projectId, payload) =>
  projectRequest(projectId, "/storyboard", "PUT", payload);
export const confirmStoryboard = (projectId, payload) =>
  projectRequest(projectId, "/storyboard/confirm", "POST", payload);
export const generateStoryboardFrameImage = (projectId, frameId, payload) =>
  projectRequest(projectId, `/storyboard/frames/${encodeURIComponent(frameId)}/generate-image`, "POST", payload);
export const resetStoryboardImages = (projectId, payload) =>
  projectRequest(projectId, "/storyboard/images/reset", "POST", payload);
export const getStoryboardFrameImageUrl = (projectId, frameId, updatedAt, download = false) =>
  `${import.meta.env.VITE_SERVER_URL}/api/projects/${projectId}/storyboard/frames/${encodeURIComponent(frameId)}/image?v=${encodeURIComponent(updatedAt || "0")}${download ? "&download=1" : ""}`;

export async function editProjectScript(id, currentScript, instruction, signal) {
  const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/api/projects/${id}/edit-script`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentScript, instruction }),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось изменить сценарий");
  if (typeof data.content !== "string" || !data.content.trim()) throw new Error("ИИ вернул пустой сценарий");
  return data.content;
}
