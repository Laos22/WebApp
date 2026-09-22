import { randomUUID } from 'node:crypto';

export function soundDesignPrompt(project) {
  const blocks = new Map((project.voiceover?.blocks || []).map(block => [block.id, block]));
  const frames = (project.storyboard?.frames || []).map(frame => ({
    frameId: frame.id,
    frameOrder: frame.order,
    blockId: frame.sourceVoiceoverBlockId,
    narration: frame.scriptText,
    visualDescription: frame.visualDescription,
    marker: frame.marker || '',
  }));
  return `You are a film sound designer. Analyze the storyboard below and suggest only sound effects that materially improve a scene. Do not suggest music, narration, dialogue, or effects for purely static shots. Prompts must be concise ENGLISH descriptions because the sound generation model works best with English. Return JSON only in this shape: {"suggestions":[{"frameId":"exact id","reason":"short Russian explanation","prompt":"English sound effect prompt","durationSec":number or null,"loop":boolean,"promptInfluence":number}]}. Use at most one suggestion per frame, at most 40 suggestions total. durationSec must be between 0.5 and 30 when provided; use null for automatic duration. promptInfluence must be between 0 and 1. Use exact frame IDs and never invent IDs. Project: ${JSON.stringify(project.title || '')}. Voiceover blocks: ${JSON.stringify([...blocks.values()].map(block => ({ id: block.id, order: block.order, title: block.sourceTitle })))}. Frames: ${JSON.stringify(frames)}`;
}

export function parseSoundDesign(text, project) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error('INVALID_SOUND_PLAN'), { code: 'INVALID_SOUND_PLAN', status: 502 }); }
  if (!parsed || !Array.isArray(parsed.suggestions)) throw Object.assign(new Error('INVALID_SOUND_PLAN'), { code: 'INVALID_SOUND_PLAN', status: 502 });
  const known = new Map((project.storyboard?.frames || []).map(frame => [frame.id, frame]));
  const seen = new Set();
  const suggestions = [];
  for (const item of parsed.suggestions.slice(0, 40)) {
    if (!item || typeof item.frameId !== 'string' || seen.has(item.frameId)) continue;
    const frame = known.get(item.frameId);
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
    if (!frame || !prompt || prompt.length > 450) continue;
    const durationSec = item.durationSec == null ? null : Number(item.durationSec);
    const promptInfluence = item.promptInfluence == null ? 0.5 : Number(item.promptInfluence);
    if (durationSec !== null && (!Number.isFinite(durationSec) || durationSec < 0.5 || durationSec > 30)) continue;
    if (!Number.isFinite(promptInfluence) || promptInfluence < 0 || promptInfluence > 1) continue;
    seen.add(item.frameId);
    suggestions.push({
      _id: randomUUID(), frameId: frame.id, blockId: frame.sourceVoiceoverBlockId, frameOrder: frame.order,
      reason: typeof item.reason === 'string' && item.reason.trim() ? item.reason.trim().slice(0, 500) : 'Звук усилит атмосферу кадра.',
      prompt, durationSec, loop: Boolean(item.loop), promptInfluence,
      status: 'suggested', effectId: '',
    });
  }
  return suggestions;
}
