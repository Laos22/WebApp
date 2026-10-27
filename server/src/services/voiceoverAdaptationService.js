export const VOICEOVER_ADAPTATION_BATCH_SIZE = 1;
export const VOICEOVER_ADAPTATION_BATCH_CHARACTERS = 12000;

export function nextVoiceoverAdaptationBatch(sourceBlocks, completedCount) {
  if (!Number.isSafeInteger(completedCount) || completedCount < 0 || completedCount >= sourceBlocks.length) return [];
  const batch = [];
  let characters = 0;
  for (const block of sourceBlocks.slice(completedCount)) {
    if (batch.length >= VOICEOVER_ADAPTATION_BATCH_SIZE ||
        (batch.length && characters + block.sourceText.length > VOICEOVER_ADAPTATION_BATCH_CHARACTERS)) break;
    batch.push(block);
    characters += block.sourceText.length;
  }
  return batch;
}

export function validVoiceoverAdaptationResults(results, sourceBlocks) {
  return Array.isArray(results) && results.length <= sourceBlocks.length &&
    results.every((result, index) => result.id === sourceBlocks[index].sourceId &&
      typeof result.adaptedText === 'string' && result.adaptedText.trim());
}

export function voiceoverAdaptationResponse(project) {
  const stage = project.voiceoverAdaptation;
  if (stage?.status !== 'in_progress') return { status: 'idle', completed: 0, total: 0, blocks: [] };
  if (project.script?.status !== 'confirmed' ||
      project.script?.revision !== stage.sourceScriptRevision ||
      (project.voiceover?.editVersion || 0) !== stage.baseEditVersion) {
    return { status: 'stale', completed: 0, total: 0, blocks: [] };
  }
  const results = stage.results || [];
  return {
    status: 'in_progress', completed: results.length,
    total: stage.totalBlocks || 0,
    instructions: stage.instructions || '', profileId: stage.profileId || '',
    sourceScriptRevision: stage.sourceScriptRevision, baseEditVersion: stage.baseEditVersion,
    blocks: results.map((result, index) => ({ order: index + 1, adaptedText: result.adaptedText })),
  };
}
