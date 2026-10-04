import { GoogleGenAI } from '@google/genai';
import { getDecryptedApiKey } from './aiProfileResolver.js';
import { coverError } from './coverService.js';

const sample = {
  observation: 'Что изображено на исходной обложке и как оформлен текст — на русском.',
  template: {
    title: { x: 6, y: 8, width: 62, height: 27, font: 'condensed', fontSize: 110, color: '#31e0dc', outlineColor: '#101820', outlineWidth: 4, align: 'left', uppercase: true },
    subtitle: { x: 6, y: 37, width: 62, height: 12, font: 'sans', fontSize: 34, color: '#ffffff', outlineColor: '#101820', outlineWidth: 2, align: 'left', uppercase: true },
    backgroundColor: '#183047', accentColor: '#eac776',
    designNotes: 'Абстрактные правила освещения, контраста и композиции без названий объектов, мест, людей и исходного текста.',
  },
};

export function coverStyleAnalysisPrompt(analysis, instruction) {
  return `Проанализируй оформление обложки и создай ПЕРЕИСПОЛЬЗУЕМЫЙ ШАБЛОН для совершенно разных тем.
${analysis ? `Предыдущий анализ: ${JSON.stringify(analysis)}\nВнеси изменения по инструкции автора: ${instruction || 'Уточни оформление.'}` : 'Изучи прикреплённое изображение. В observation по-русски расскажи, что видишь: сюжет, текст и оформление.'}
Отдели наблюдение о сюжете от стиля: observation может описывать исходную сцену, но template должен содержать ТОЛЬКО оформление. Нельзя переносить из исходника названия, персонажей, здания, пейзажи и другие тематические объекты. designNotes — на русском, только тип освещения, контраст, свободные области и расположение главного объекта в общем виде.
Верни JSON строго по образцу: ${JSON.stringify(sample)}
title и subtitle задают область надписи: x/y/width/height в процентах холста 16:9 от верхнего левого угла. Вся область должна помещаться на холсте с отступами, области текста не должны пересекаться. font: condensed, sans или serif (ближайший характер шрифта). fontSize в пикселях на холсте 1280x720, от 16 до 180. outlineWidth от 0 до 10. Цвета строго #RRGGBB. align: left, center или right. uppercase: boolean. Никаких картинок, ссылок или SVG в JSON.`;
}

export async function analyzeCoverStyle({ profile, image, analysis, instruction }) {
  if (!profile || profile.type !== 'text' || profile.provider !== 'google_studio') throw coverError(400, 'Для анализа примера выберите текстовый профиль Google Studio.');
  const apiKey = getDecryptedApiKey(profile);
  const model = profile.textSettings?.primaryModel?.trim();
  if (!apiKey || !model) throw coverError(400, 'В профиле анализа укажите модель и API-ключ Google Studio.');
  const parts = [{ text: coverStyleAnalysisPrompt(analysis, instruction) }];
  if (!analysis) parts.push({ inlineData: { mimeType: image.mimeType, data: image.buffer.toString('base64') } });
  const result = await new GoogleGenAI({ apiKey }).models.generateContent({
    model, contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 5000, httpOptions: { timeout: 90000 } },
  });
  const text = typeof result.text === 'function' ? result.text() : result.text;
  return parseCoverAnalysis(text || '');
}

export function validateCoverTemplate(value) {
  const bad = () => { throw coverError(502, 'Модель вернула некорректный шаблон. Повторите анализ или уточните инструкцию.'); };
  if (!value || typeof value !== 'object') bad();
  const color = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : bad();
  const number = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : bad();
  const region = v => {
    if (!v || !['sans', 'serif', 'condensed'].includes(v.font) || !['left', 'center', 'right'].includes(v.align) || typeof v.uppercase !== 'boolean') bad();
    const result = {
      x: number(v.x, 2, 95), y: number(v.y, 2, 95), width: number(v.width, 10, 96), height: number(v.height, 4, 90),
      font: v.font, fontSize: number(v.fontSize, 16, 180), color: color(v.color),
      outlineColor: color(v.outlineColor), outlineWidth: number(v.outlineWidth, 0, 10), align: v.align, uppercase: v.uppercase,
    };
    if (result.x + result.width > 98 || result.y + result.height > 98) bad();
    return result;
  };
  if (typeof value.designNotes !== 'string' || value.designNotes.length > 2000) bad();
  const template = { title: region(value.title), subtitle: region(value.subtitle), backgroundColor: color(value.backgroundColor), accentColor: color(value.accentColor), designNotes: value.designNotes.trim() };
  const a = template.title, b = template.subtitle;
  if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) bad();
  return template;
}

export function parseCoverAnalysis(text) {
  let parsed;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()); }
  catch { throw coverError(502, 'Не удалось прочитать анализ образца. Попробуйте ещё раз.'); }
  if (typeof parsed.observation !== 'string' || !parsed.observation.trim() || parsed.observation.length > 4000) throw coverError(502, 'Модель не описала образец. Повторите анализ.');
  return { observation: parsed.observation.trim(), template: validateCoverTemplate(parsed.template) };
}

const escape = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));

export function coverTemplateSvg(template, title = 'ЗАГОЛОВОК', subtitle = 'Подзаголовок видео') {
  const t = validateCoverTemplate(template);
  const textBlock = (text, style) => {
    if (!text) return '';
    const content = style.uppercase ? text.toLocaleUpperCase() : text;
    const width = style.width * 12.8, height = style.height * 7.2;
    let size = Math.min(style.fontSize, height * .8);
    const lines = [];
    let line = '';
    const maxChars = Math.max(5, Math.floor(width / (size * .62)));
    for (const word of content.split(/\s+/)) {
      if (line && (line + ' ' + word).length > maxChars) { lines.push(line); line = word; } else line += (line ? ' ' : '') + word;
    }
    if (line) lines.push(line);
    size = Math.min(size, height / (lines.length * 1.15), width / (Math.max(...lines.map(line => line.length)) * .65));
    const x = (style.x + (style.align === 'right' ? style.width : style.align === 'center' ? style.width / 2 : 0)) * 12.8;
    const y = style.y * 7.2 + size;
    const font = { sans: 'Arial, sans-serif', serif: 'Georgia, serif', condensed: 'Impact, sans-serif' }[style.font];
    return `<text fill="${style.color}" stroke="${style.outlineColor}" stroke-width="${style.outlineWidth}" paint-order="stroke" stroke-linejoin="round" font-family="${font}" font-weight="bold" font-size="${size}" text-anchor="${{left:'start',center:'middle',right:'end'}[style.align]}">${lines.map((line, i) => `<tspan x="${x}" y="${y + i * size * 1.15}">${escape(line)}</tspan>`).join('')}</text>`;
  };
  // A neutral layout preview contains none of the original reference's subject matter.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${t.backgroundColor}"/><stop offset="1" stop-color="${t.accentColor}" stop-opacity=".5"/></linearGradient></defs><rect width="1280" height="720" fill="${t.backgroundColor}"/><rect width="1280" height="720" fill="url(#bg)"/>${textBlock(title, t.title)}${textBlock(subtitle, t.subtitle)}</svg>`;
}
