const plain = value => value?.toObject ? value.toObject() : value;

export function shortResponse(value) {
  const item = plain(value);
  return { id: String(item._id), title: item.title, hook: item.hook || '', narration: item.narration,
    shots: item.shots.map(shot => ({ frameId: shot.frameId, horizontalOffset: shot.horizontalOffset || 0,
      durationWeight: shot.durationWeight || 1 })),
    sourceStoryboardRevision: item.sourceStoryboardRevision, version: item.version,
    narrationRevision: item.narrationRevision,
    audio: { status: item.audio?.status || 'empty', durationSec: item.audio?.durationSec || null,
      generatedAt: item.audio?.generatedAt || null },
    createdAt: item.createdAt, updatedAt: item.updatedAt };
}

export function validateShortDraft(body, frameIds) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['title', 'hook', 'narration', 'shots'].includes(key))) return null;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const hook = typeof body.hook === 'string' ? body.hook.trim() : '';
  const narration = typeof body.narration === 'string' ? body.narration.trim() : '';
  if (!title || title.length > 120 || hook.length > 500 || !narration || narration.length > 3000 ||
      !Array.isArray(body.shots) || body.shots.length < 1 || body.shots.length > 24) return null;
  const seen = new Set();
  const shots = [];
  for (const shot of body.shots) {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot) ||
        Object.keys(shot).some(key => !['frameId', 'horizontalOffset', 'durationWeight'].includes(key)) ||
        typeof shot.frameId !== 'string' || !frameIds.has(shot.frameId) || seen.has(shot.frameId)) return null;
    const horizontalOffset = shot.horizontalOffset ?? 0;
    const durationWeight = shot.durationWeight ?? 1;
    if (!Number.isFinite(horizontalOffset) || Math.abs(horizontalOffset) > 40 ||
        !Number.isFinite(durationWeight) || durationWeight < 1 || durationWeight > 5) return null;
    seen.add(shot.frameId);
    shots.push({ frameId: shot.frameId, horizontalOffset, durationWeight });
  }
  return { title, hook, narration, shots };
}

export function shortSuggestionPrompt(project, frames = project.storyboard?.frames || []) {
  return JSON.stringify({
    task: 'Предложи 3 самостоятельных вертикальных шортса по 30–60 секунд из этого ролика. Каждый должен иметь сильное начало, одну законченную мысль и финал. Текст диктора пиши на языке исходного сценария. Используй только указанные номера кадров. Не копируй длинный ролик целиком.',
    response: { suggestions: [{ title: 'Название', hook: 'Зацепка первых секунд', narration: 'Полный короткий текст диктора', frameOrders: [1, 2, 3] }] },
    projectTitle: project.shortTitle || project.title,
    script: String(project.script?.content || '').slice(0, 5000),
    frames: frames.map(frame => ({ order: frame.order, narration: String(frame.scriptText || '').slice(0, 130),
      visual: String(frame.visualDescription || '').slice(0, 130) })),
  });
}

export function parseShortSuggestions(text, frames) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch { return null; }
  const items = Array.isArray(parsed) ? parsed : parsed?.suggestions;
  if (!Array.isArray(items) || items.length < 1 || items.length > 5) return null;
  const frameByOrder = new Map(frames.map(frame => [frame.order, frame]));
  const suggestions = [];
  for (const item of items) {
    if (!item || typeof item.title !== 'string' || typeof item.narration !== 'string' ||
        !Array.isArray(item.frameOrders)) return null;
    const orders = [...new Set(item.frameOrders)];
    if (orders.length < 1 || orders.length > 24 || orders.some(order => !Number.isSafeInteger(order) || !frameByOrder.has(order))) return null;
    const draft = validateShortDraft({ title: item.title, hook: item.hook || '', narration: item.narration,
      shots: orders.map(order => ({ frameId: frameByOrder.get(order).id })) },
    new Set(frames.map(frame => frame.id)));
    if (!draft) return null;
    suggestions.push(draft);
  }
  return suggestions;
}
