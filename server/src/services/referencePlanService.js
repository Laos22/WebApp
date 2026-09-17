import { randomUUID } from 'node:crypto';

const types = new Set(['character', 'location', 'object', 'other']);
const idPattern = /^ref_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function cleanText(value, max) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.length <= max ? text : text.slice(0, max);
}

export function emptyReferencePlan() {
  return {
    status: 'empty', revision: 0, editVersion: 0, sourceScriptRevision: null,
    instructions: '', items: [], updatedAt: null, confirmedAt: null,
  };
}

export function normalizeReferencePlan(project) {
  const source = project?.referencePlan?.toObject?.() ?? project?.referencePlan;
  return source && typeof source === 'object' ? source : emptyReferencePlan();
}

export function parseReferenceAnalysis(rawText, currentItems = []) {
  let parsed;
  try { parsed = JSON.parse(rawText); } catch { parsed = null; }
  const input = Array.isArray(parsed) ? parsed : parsed?.references;
  if (!Array.isArray(input) || input.length > 100) {
    const error = new Error('INVALID_REFERENCE_ANALYSIS');
    error.code = 'INVALID_REFERENCE_ANALYSIS';
    throw error;
  }
  const existing = new Map(currentItems.map(item => [item.id, item]));
  const used = new Set();
  return input.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REFERENCE_ANALYSIS');
    const name = cleanText(value.name, 200);
    if (!name) throw new Error('INVALID_REFERENCE_ANALYSIS');
    let id = typeof value.id === 'string' && idPattern.test(value.id) && existing.has(value.id) ? value.id : `ref_${randomUUID()}`;
    while (used.has(id)) id = `ref_${randomUUID()}`;
    used.add(id);
    const old = existing.get(id);
    const next = {
      id, name,
      type: types.has(value.type) ? value.type : 'other',
      description: cleanText(value.description, 4000),
      reason: cleanText(value.reason, 2000),
      mentions: Number.isSafeInteger(value.mentions) && value.mentions >= 0 ? value.mentions : 0,
      prompt: cleanText(value.prompt, 12000),
      selected: typeof value.selected === 'boolean' ? value.selected : true,
    };
    const changed = !old || ['name', 'type', 'description', 'reason', 'prompt'].some(key => old[key] !== next[key]);
    return { ...next, version: old ? old.version + (changed ? 1 : 0) : 1 };
  });
}

export function validateReferenceItems(input, currentItems = []) {
  if (!Array.isArray(input) || input.length > 100) throw new Error('INVALID_REFERENCE_PLAN');
  const current = new Map(currentItems.map(item => [item.id, item]));
  const ids = new Set();
  return input.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !['id', 'name', 'type', 'description', 'reason', 'mentions', 'prompt', 'selected'].includes(key))) {
      throw new Error('INVALID_REFERENCE_PLAN');
    }
    const id = value.id || `ref_${randomUUID()}`;
    if (!idPattern.test(id) || ids.has(id) || (value.id && !current.has(id))) throw new Error('INVALID_REFERENCE_PLAN');
    ids.add(id);
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 || !types.has(value.type) ||
        typeof value.description !== 'string' || value.description.length > 4000 ||
        typeof value.reason !== 'string' || value.reason.length > 2000 ||
        !Number.isSafeInteger(value.mentions) || value.mentions < 0 ||
        typeof value.prompt !== 'string' || value.prompt.length > 12000 || typeof value.selected !== 'boolean') {
      throw new Error('INVALID_REFERENCE_PLAN');
    }
    const next = { id, name: value.name.trim(), type: value.type, description: value.description.trim(), reason: value.reason.trim(), mentions: value.mentions, prompt: value.prompt.trim(), selected: value.selected };
    const old = current.get(id);
    const changed = !old || ['name', 'type', 'description', 'reason', 'prompt'].some(key => old[key] !== next[key]);
    return { ...next, version: old ? old.version + (changed ? 1 : 0) : 1 };
  });
}
