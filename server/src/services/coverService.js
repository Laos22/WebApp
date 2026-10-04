import sharp from 'sharp';
import { detectImageFormat } from './visualReferenceStorage.js';

export const DEFAULT_COVER_PROMPT = 'Создай выразительную обложку YouTube в формате 16:9. Сохрани узнаваемый стиль образца: композицию, расположение и иерархию текста, характер шрифта, палитру и освещение. Адаптируй сюжет к теме нового видео. Главный объект и текст должны хорошо читаться даже на маленькой миниатюре.';
export const MAX_COVER_BYTES = 15 * 1024 * 1024;

export function coverError(status, message) {
  return Object.assign(new Error(message), { status, publicMessage: message });
}

export function coverFields(body = {}, requireTitle = true) {
  const result = {};
  for (const [key, max] of Object.entries({ title: 120, subtitle: 180, instruction: 4000 })) {
    const value = body[key] ?? '';
    if (typeof value !== 'string' || value.length > max) throw coverError(400, `Поле «${{title:'Заголовок', subtitle:'Подзаголовок', instruction:'Инструкция'}[key]}» — до ${max} символов.`);
    result[key] = value.trim();
  }
  if (requireTitle && !result.title) throw coverError(400, 'Введите или предложите заголовок обложки.');
  return result;
}

export function buildCoverPrompt({ systemPrompt, project, title, subtitle, instruction, template }) {
  return `${systemPrompt?.trim() || DEFAULT_COVER_PROMPT}

PROJECT TOPIC: ${String(project.title || project.shortTitle || '').slice(0, 1000)}
PROJECT DESCRIPTION: ${String(project.description || '').slice(0, 4000)}
AUTHOR INSTRUCTIONS: ${instruction || 'Follow the approved design template.'}

TASK: Produce ONE finished YouTube cover image, landscape 16:9, including the lettering.
The attached image is a neutral TYPOGRAPHY LAYOUT made from the approved template, not a background to copy. Replace the plain background with a vivid scene based ONLY on the PROJECT TOPIC and DESCRIPTION above. Preserve the text placement, hierarchy and colors. Do not use a previous example's scene or subject matter. Arrange the new scene around the text; keep important subjects visible.
APPROVED DESIGN TEMPLATE (x/y/width/height in percent from the top-left, fontSize on 1280x720): ${JSON.stringify(template || {})}
Render only the following supplied text, verbatim, in its original language and alphabet. Do not translate it, add words or reuse the sample's wording.
TITLE: ${JSON.stringify(title)}
SUBTITLE: ${JSON.stringify(subtitle)}
${subtitle ? 'Keep the subtitle subordinate but legible.' : 'No subtitle is requested.'}
No platform UI, timestamps, view counts or watermarks.
Deliver the final image with the title and subtitle integrated into its design, not JSON, not a description, not a collage of variants.`;
}

export function buildCoverHeadlinesPrompt({ systemPrompt, project, title, subtitle, instruction }) {
  return `${systemPrompt?.trim() || DEFAULT_COVER_PROMPT}
Тема: ${String(project.title || project.shortTitle || '').slice(0, 1000)}
Описание: ${String(project.description || '').slice(0, 4000)}
Текущий заголовок: ${JSON.stringify(title)}
Текущий подзаголовок: ${JSON.stringify(subtitle)}
Инструкция автора: ${instruction || 'Предложи яркий короткий заголовок и дополняющий его подзаголовок.'}
Сейчас нужна ТОЛЬКО пара текстов для обложки, а не изображение. Если есть инструкция изменения, переработай текущие тексты согласно ей. Сохрани язык темы, если автор не попросил другой. Заголовок — желательно 1–5 слов, подзаголовок — короткая интрига без выдуманных фактов. Верни только JSON: {"title":"...","subtitle":"..."}. title до 120 символов, subtitle до 180.`;
}

export async function validateCoverImage(buffer, normalize = false) {
  try {
    const format = detectImageFormat(buffer);
    const decoder = sharp(buffer, { limitInputPixels: 40000000, failOn: 'error' });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages || 1) !== 1) throw new Error('Invalid image');
    if (normalize) {
      const image = await decoder.rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
      return { buffer: image, mimeType: 'image/jpeg' };
    }
    // Decode the pixels as well as the header before accepting imported/generated files.
    await decoder.stats();
    return { buffer, mimeType: format.mimeType };
  } catch { throw coverError(415, 'Не удалось открыть изображение. Используйте обычный PNG, JPEG или WebP до 15 МБ.'); }
}
