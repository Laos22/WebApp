import { GoogleGenAI } from "@google/genai";
import { getDecryptedApiKey } from "./aiProfileResolver.js";
import { detectImageFormat } from "./visualReferenceStorage.js";

export const DEFAULT_GOOGLE_IMAGE_MODEL = "gemini-3.1-flash-image";

function generationError(code, publicMessage, cause) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  if (cause) error.cause = cause;
  return error;
}

export function normalizeGoogleImageSettings(profile) {
  if (!profile || profile.type !== "image" || profile.provider !== "google_studio") {
    throw generationError("INVALID_IMAGE_PROFILE", "Выберите профиль изображения Google Studio.");
  }
  const apiKey = getDecryptedApiKey(profile);
  if (!apiKey) throw generationError("IMAGE_API_KEY_MISSING", "В выбранном профиле не указан корректный API-ключ Google Studio.");
  const model = profile.imageSettings?.model?.trim() || DEFAULT_GOOGLE_IMAGE_MODEL;
  const requestedFormat = profile.imageSettings?.format === "png" ? "image/png" : "image/jpeg";
  const aspectRatio = profile.imageSettings?.aspectRatio || "16:9";
  const imageSize = profile.imageSettings?.quality === "hd" && !model.includes("flash-lite") ? "2K" : "1K";
  return { apiKey, model, mimeType: requestedFormat, aspectRatio, imageSize };
}

export function buildGoogleImageInput(frame, references) {
  const input = [{
    type: "text",
    text: `Create one final storyboard image. Follow the image prompt exactly. Do not create a collage, split screen, captions, logos, interface elements, or watermarks.\n\nIMAGE PROMPT:\n${frame.prompt}`,
  }];
  references.forEach((reference, index) => {
    input.push({
      type: "text",
      text: `Reference image ${index + 1}: ${reference.name} (${reference.type}). Preserve the relevant identity, appearance and design when this entity is visible in the frame.`,
    });
    input.push({ type: "image", mime_type: reference.mimeType, data: reference.buffer.toString("base64") });
  });
  return input;
}

export async function generateGoogleStoryboardImage({ frame, references = [], profile, clientFactory }) {
  const settings = normalizeGoogleImageSettings(profile);
  const createClient = clientFactory || (apiKey => new GoogleGenAI({ apiKey }));
  try {
    const client = createClient(settings.apiKey);
    const interaction = await client.interactions.create({
      model: settings.model,
      input: buildGoogleImageInput(frame, references),
      response_format: {
        type: "image",
        mime_type: settings.mimeType,
        aspect_ratio: settings.aspectRatio,
        image_size: settings.imageSize,
      },
    });
    const output = interaction?.output_image;
    if (!output?.data) throw generationError("EMPTY_IMAGE_RESPONSE", "Google Studio не вернул изображение.");
    const buffer = Buffer.from(output.data, "base64");
    const detected = detectImageFormat(buffer);
    return { buffer, mimeType: detected.mimeType, model: settings.model };
  } catch (error) {
    if (error?.code && error?.publicMessage) throw error;
    const status = Number(error?.status || error?.statusCode || error?.response?.status);
    if (status === 401 || status === 403) {
      throw generationError("IMAGE_PROVIDER_AUTH_FAILED", "Google Studio отклонил API-ключ или доступ к модели.", error);
    }
    if (status === 429) throw generationError("IMAGE_PROVIDER_RATE_LIMIT", "Google Studio временно ограничил запросы. Продолжите генерацию позже.", error);
    throw generationError("IMAGE_GENERATION_FAILED", "Google Studio не смог сгенерировать изображение кадра.", error);
  }
}
