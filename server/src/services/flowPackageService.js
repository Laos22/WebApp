import path from "node:path";

const frameIdPattern = /frame_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const imageExtensionPattern = /\.(png|jpe?g|webp)$/i;

export function flowFrameBaseName(frame) {
  const readableName = /^frame_\d+_\d+$/.test(frame.fileBaseName || "")
    ? frame.fileBaseName
    : `frame_${String(frame.order).padStart(4, "0")}`;
  return `${readableName}__${frame.id}`;
}

export function flowReferenceFileName(item, mimeType) {
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `references/${item.id}.${extension}`;
}

export function frameIdFromFlowImagePath(value) {
  if (typeof value !== "string" || value.includes("\\") || value.startsWith("/") ||
      value.split("/").includes("..") || !imageExtensionPattern.test(value)) return null;
  return path.posix.basename(value).match(frameIdPattern)?.[0] || null;
}

export function buildFlowManifest({ project, storyboard, frames, references }) {
  const referenceById = new Map(references.map(reference => [reference.id, reference]));
  return {
    schemaVersion: 1,
    projectId: project._id.toString(),
    projectTitle: project.title || "",
    storyboardRevision: storyboard.revision,
    createdAt: new Date().toISOString(),
    frames: frames.map(frame => ({
      frameId: frame.id,
      order: frame.order,
      scriptText: frame.scriptText,
      promptFile: `prompts/${flowFrameBaseName(frame)}.txt`,
      outputFile: `images/${flowFrameBaseName(frame)}.png`,
      referenceFiles: frame.referenceIds.map(id => referenceById.get(id)?.fileName).filter(Boolean),
    })),
    references: references.map(reference => ({
      referenceId: reference.id,
      name: reference.name,
      type: reference.type,
      fileName: reference.fileName,
    })),
  };
}

export function flowPromptsText(frames) {
  return frames.map(frame => [
    `КАДР ${frame.order}`,
    `frameId: ${frame.id}`,
    `Имя результата: ${flowFrameBaseName(frame)}.png`,
    `Текст озвучки: ${frame.scriptText}`,
    `PROMPT:\n${frame.prompt}`,
  ].join("\n")).join("\n\n========================================\n\n");
}
