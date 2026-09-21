import crypto from 'node:crypto';

const blockIdPattern = /^voice_block_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sourceIdPattern = /^script_block_[1-9][0-9]*$/;

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length <= max ? text : '';
}

export function splitScenarioBlocks(script) {
  const content = cleanText(script, 500000).replace(/\r\n?/g, '\n');
  if (!content) return [];
  const heading = /^(?:\s*#{1,6}\s*)?(?:Блок|Block)\s+([1-9][0-9]*)[^\n]*$/gimu;
  const matches = [...content.matchAll(heading)];
  if (!matches.length) {
    return [{ sourceId: 'script_block_1', order: 1, sourceTitle: 'Блок 1', sourceText: content }];
  }
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    const sourceText = content.slice(start, end).trim();
    if (!sourceText) {
      const error = new Error('Empty script block');
      error.code = 'EMPTY_SCRIPT_BLOCK';
      throw error;
    }
    return {
      sourceId: `script_block_${index + 1}`,
      order: index + 1,
      sourceTitle: match[0].trim(),
      sourceText,
    };
  });
}

export function parseAdaptedBlocks(raw, sourceBlocks, previousBlocks = []) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    const error = new Error('Invalid adaptation response');
    error.code = 'INVALID_AUDIO_ADAPTATION_RESPONSE';
    throw error;
  }
  const input = parsed?.blocks;
  if (!Array.isArray(input) || input.length !== sourceBlocks.length) {
    const error = new Error('Adaptation block count mismatch');
    error.code = 'AUDIO_BLOCK_COUNT_MISMATCH';
    throw error;
  }
  const bySourceId = new Map(input.map(value => [value?.id, value]));
  if (bySourceId.size !== sourceBlocks.length) {
    const error = new Error('Duplicate adaptation block');
    error.code = 'INVALID_AUDIO_ADAPTATION_RESPONSE';
    throw error;
  }
  const previousByOrder = new Map(previousBlocks.map(block => [block.order, block]));
  return sourceBlocks.map(source => {
    const value = bySourceId.get(source.sourceId);
    if (!value || Object.keys(value).some(key => !['id', 'adaptedText'].includes(key)) ||
        !sourceIdPattern.test(value.id)) {
      const error = new Error('Invalid adaptation block');
      error.code = 'INVALID_AUDIO_ADAPTATION_RESPONSE';
      throw error;
    }
    const adaptedText = cleanText(value.adaptedText, 50000);
    if (!adaptedText) {
      const error = new Error('Empty adaptation block');
      error.code = 'INVALID_AUDIO_ADAPTATION_RESPONSE';
      throw error;
    }
    const old = previousByOrder.get(source.order);
    return {
      id: old?.id && blockIdPattern.test(old.id) ? old.id : `voice_block_${crypto.randomUUID()}`,
      order: source.order,
      sourceTitle: source.sourceTitle,
      sourceText: source.sourceText,
      adaptedText,
      textRevision: old?.adaptedText === adaptedText ? old.textRevision : (old?.textRevision || 0) + 1,
      audioStatus: old?.adaptedText === adaptedText && old?.audioStatus === 'ready' ? 'ready' : 'pending',
      audioStorageKey: old?.adaptedText === adaptedText ? old.audioStorageKey || '' : '',
      audioMimeType: old?.adaptedText === adaptedText ? old.audioMimeType || '' : '',
      audioDurationSec: old?.adaptedText === adaptedText ? old.audioDurationSec ?? null : null,
      audioByteSize: old?.adaptedText === adaptedText ? old.audioByteSize || 0 : 0,
      audioProfileId: old?.adaptedText === adaptedText ? old.audioProfileId || '' : '',
      audioGeneratedAt: old?.adaptedText === adaptedText ? old.audioGeneratedAt || null : null,
      audioErrorCode: '',
    };
  });
}

export function normalizeVoiceover(project) {
  const source = project?.voiceover?.toObject?.() ?? project?.voiceover ?? {};
  return {
    status: source.status ?? 'empty', revision: source.revision ?? 0,
    editVersion: source.editVersion ?? 0,
    sourceScriptRevision: source.sourceScriptRevision ?? null,
    instructions: source.instructions ?? '',
    blocks: (source.blocks ?? []).map(block => ({
      id: block.id, order: block.order, sourceTitle: block.sourceTitle ?? '',
      sourceText: block.sourceText ?? '', adaptedText: block.adaptedText ?? '',
      textRevision: block.textRevision ?? 1, audioStatus: block.audioStatus ?? 'pending',
      audioDurationSec: block.audioDurationSec ?? null,
      audioMimeType: block.audioMimeType ?? '', audioByteSize: block.audioByteSize ?? 0,
      audioProfileId: block.audioProfileId ?? '', audioGeneratedAt: block.audioGeneratedAt ?? null,
      audioErrorCode: block.audioErrorCode ?? '',
    })),
    updatedAt: source.updatedAt ?? null, confirmedAt: source.confirmedAt ?? null,
  };
}

export function validateManualVoiceoverBlocks(input, currentBlocks) {
  if (!Array.isArray(input) || input.length !== currentBlocks.length) {
    const error = new Error('Invalid voiceover blocks');
    error.code = 'INVALID_VOICEOVER_BLOCKS';
    throw error;
  }
  return currentBlocks.map((old, index) => {
    const value = input[index];
    if (!value || Object.keys(value).some(key => !['id', 'adaptedText'].includes(key)) ||
        value.id !== old.id || !blockIdPattern.test(value.id)) {
      const error = new Error('Invalid voiceover block');
      error.code = 'INVALID_VOICEOVER_BLOCKS';
      throw error;
    }
    const adaptedText = cleanText(value.adaptedText, 50000);
    if (!adaptedText) {
      const error = new Error('Empty voiceover block');
      error.code = 'INVALID_VOICEOVER_BLOCKS';
      throw error;
    }
    if (adaptedText === old.adaptedText) return { ...old };
    return {
      ...old, adaptedText, textRevision: (old.textRevision || 0) + 1,
      audioStatus: old.audioStatus === 'ready' ? 'stale' : 'pending', audioErrorCode: '',
    };
  });
}

export function voiceoverIsCurrent(project, voiceover = normalizeVoiceover(project)) {
  return project?.script?.status === 'confirmed' &&
    voiceover.sourceScriptRevision === project.script.revision;
}
