import { createHash } from 'node:crypto';
import { timelinePlan, TIMEBASE } from './davinciXmlService.js';
import { normalizeStoryboard, storyboardIsCurrent } from './storyboardService.js';
import { voiceoverIsCurrent } from './voiceoverService.js';
import { hasAudioDuration } from './audioDuration.js';

export const DESCRIPTION_FILENAME = 'youtube_description.txt';
export const MAX_DESCRIPTION_LENGTH = 5000;
export const DEFAULT_YOUTUBE_DESCRIPTION_PROMPT = `Ты редактор YouTube-канала. Подготовь готовое описание видео на языке сценария.
Первые две строки должны заинтересовать зрителя и ясно передать тему. Затем кратко расскажи, что он узнает, не пересказывая весь сюжет. Используй только факты из сценария, не выдумывай ссылки, источники, спонсоров или обещания.
Добавь понятные названия глав по предложенному таймлайну, если он доступен, и 3–5 уместных хештегов. Пиши естественно, без канцелярита и нагромождения ключевых слов. Учитывай инструкции автора. При редактировании сохраняй всё, что автор не просил менять.`;

export function descriptionError(status, message) {
  return Object.assign(new Error(message), { status, publicMessage: message });
}

export function validateDescription(content) {
  if (typeof content !== 'string' || !content.trim() || content.length > MAX_DESCRIPTION_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) {
    throw descriptionError(400, 'Описание должно содержать от 1 до 5000 символов.');
  }
  return content.trim();
}

export function formatYoutubeTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(value / 60);
  const suffix = `${String(minutes % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${suffix}` : suffix;
}

export function descriptionSourceFingerprint(project) {
  return createHash('sha256').update(JSON.stringify({
    title: project.title, script: project.script, voiceover: {
      status: project.voiceover?.status, revision: project.voiceover?.revision,
      sourceScriptRevision: project.voiceover?.sourceScriptRevision,
      blocks: (project.voiceover?.blocks || []).map(b => [b.id, b.order, b.adaptedText, b.audioStatus, b.audioDurationSec, b.audioGeneratedAt]),
    },
    storyboard: project.storyboard, references: [project.referencePlan?.status, project.referencePlan?.revision],
  })).digest('hex');
}

// Chapter boundaries use the very same plan as FCPXML. Trims and transitions in
// that exporter do not move block offsets. Never estimate timestamps from text.
export function descriptionTimeline(project) {
  const empty = message => ({ ready: false, durationSec: null, chapters: [], message });
  const blocks = project.voiceover?.blocks || [];
  const storyboard = normalizeStoryboard(project);
  if (!voiceoverIsCurrent(project) || project.voiceover?.status !== 'confirmed' ||
      storyboard.status !== 'confirmed' || !storyboardIsCurrent(project, storyboard)) {
    return empty('Таймкоды появятся после подтверждения актуальной озвучки и раскадровки. Пока можно создать описание без них.');
  }
  if (!blocks.length || blocks.some(b => b.audioStatus !== 'ready' || !hasAudioDuration(b.audioDurationSec))) {
    return empty('Для точных таймкодов нужны все готовые блоки озвучки с измеренной длительностью. Пока описание будет без таймкодов.');
  }
  try {
    const plan = timelinePlan(blocks, storyboard.frames);
    const durationSec = plan.duration / TIMEBASE;
    const chapters = [];
    for (const item of plan.blocks) {
      const startSec = Math.floor(item.offset / TIMEBASE);
      // Avoid chapter starts less than ten seconds apart or at the very end.
      if (durationSec - startSec < 10 || (chapters.length && startSec - chapters.at(-1).startSec < 10)) continue;
      chapters.push({ blockId: item.block.id, startSec, timestamp: formatYoutubeTime(startSec),
        title: item.block.sourceTitle || `Блок ${item.block.order}`, text: item.block.adaptedText || item.block.sourceText || '' });
    }
    return { ready: true, durationSec, chapters, message: 'Таймкоды рассчитаны по озвучке, как в экспорте DaVinci. Изменения монтажа вручную в DaVinci здесь не учитываются.' };
  } catch {
    return empty('Структура таймлайна изменилась. Проверьте раскадровку; описание пока можно создать без таймкодов.');
  }
}

export function buildDescriptionPrompt({ project, timeline, systemPrompt, instruction, content }) {
  return `${systemPrompt?.trim() || DEFAULT_YOUTUBE_DESCRIPTION_PROMPT}

ЗАДАЧА: ${content ? 'Отредактируй текущее описание по инструкции автора.' : 'Создай новое описание видео.'}
Инструкция автора: ${JSON.stringify(instruction || 'Нет дополнительных инструкций.')}
Текущее описание: ${JSON.stringify(content || '')}
Название видео: ${JSON.stringify(project.title || project.shortTitle)}
СЦЕНАРИЙ (источник материала):
${project.script.content}

ДОСТУПНЫЕ НАЧАЛА ГЛАВ (blockId, реальное время и содержание):
${JSON.stringify(timeline.chapters)}

ФОРМАТ ОТВЕТА — только JSON: {"description":"основной текст", "chaptersTitle":"название раздела глав на языке описания", "chapters":[{"blockId":"ID из списка", "title":"короткое название главы"}], "footer":"завершающий текст и хештеги"}.
Не вставляй таймкоды в description или footer: приложение само подставит время по blockId.
Если есть доступные главы, выбери от 3 до 12 содержательных глав (либо все, если их меньше трёх), обязательно начиная с первого blockId. Объединяй близкие темы, пропуская промежуточные начала. Не придумывай ID.
Если списка нет или автор просит без глав, chapters должен быть пустым. Весь итоговый текст вместе с главами — не более 5000 символов, ориентир до 4000. Без Markdown-заголовков, ограждений кода и пояснений о процессе.`;
}

export function parseDescriptionResult(answer, timeline) {
  const invalid = () => descriptionError(502, 'Модель вернула некорректное описание или главы. Попробуйте ещё раз или выберите другой текстовый профиль.');
  let data;
  try { data = JSON.parse(String(answer).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw invalid(); }
  if (!data || typeof data.description !== 'string' || !data.description.trim() ||
      (data.footer !== undefined && typeof data.footer !== 'string') ||
      (data.chaptersTitle !== undefined && typeof data.chaptersTitle !== 'string') ||
      !Array.isArray(data.chapters) || data.chapters.length > 30) throw invalid();
  const footer = data.footer || '';
  const chaptersTitle = data.chaptersTitle || 'Главы';
  const seen = new Set();
  const chapters = data.chapters.map(chapter => {
    const source = timeline.chapters.find(item => item.blockId === chapter?.blockId);
    if (!source || seen.has(source.blockId) || typeof chapter.title !== 'string' || !chapter.title.trim() || chapter.title.length > 140 || /[\r\n]/.test(chapter.title)) throw invalid();
    seen.add(source.blockId);
    return { ...source, title: chapter.title.trim() };
  }).sort((a, b) => a.startSec - b.startSec);
  if (chapters.length && chapters[0].startSec !== 0) throw invalid();
  // A provider must not smuggle guessed chapter times into the free-text fields.
  if (/^\s*(?:[-*•]\s*)?\d{1,3}:\d{2}(?::\d{2})?\b/m.test([data.description, footer, chaptersTitle].join('\n'))) throw invalid();
  const sections = [data.description.trim()];
  if (chapters.length) sections.push([chaptersTitle.trim(), ...chapters.map(c => `${c.timestamp} ${c.title}`)].filter(Boolean).join('\n'));
  if (footer.trim()) sections.push(footer.trim());
  const content = sections.join('\n\n');
  try { validateDescription(content); } catch { throw invalid(); }
  const warnings = [];
  if (!timeline.ready) warnings.push(timeline.message);
  else if (!chapters.length) warnings.push('Описание создано без глав. Их можно добавить по инструкции для редактирования.');
  else if (chapters.length < 3) warnings.push('В описании меньше трёх таймкодов: YouTube может не отобразить их как главы.');
  return { content, warnings };
}
