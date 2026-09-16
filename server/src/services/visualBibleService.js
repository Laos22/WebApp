import { randomUUID } from 'node:crypto';

const styleFields = {
  concept: 'text', realism: 'text', colorPalette: 'list', lightingRules: 'list',
  cameraRules: 'list', textureRules: 'list', promptAnchorEn: 'text', avoid: 'list',
};
const common = { name: 'name', sourceFacts: 'list', designDecisions: 'list' };
const collections = {
  visualModes: { prefix: 'mode', max: 20, fields: {
    name: 'name', purpose: 'text', styleEn: 'text', paletteEn: 'text',
    lightingOptionsEn: 'list', cameraOptionsEn: 'list', atmosphereOptionsEn: 'list', avoidEn: 'list',
  } },
  characters: { prefix: 'char', max: 100, fields: {
    ...common, role: 'text', recurring: 'boolean', identityAnchorEn: 'text',
    defaultWardrobeEn: 'text', optionalPropsEn: 'list',
  } },
  locations: { prefix: 'loc', max: 100, fields: {
    ...common, identityAnchorEn: 'text', variableConditionsEn: 'list',
  } },
  objects: { prefix: 'obj', max: 100, fields: { ...common, visualAnchorEn: 'text' } },
};
const contentFields = ['visualStyle', 'continuityRules', ...Object.keys(collections)];
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

function invalid(field) {
  const error = new Error(`Неверное поле Visual Bible: ${field}`);
  error.status = 400;
  throw error;
}

function object(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(key => !allowed.includes(key))) invalid(field);
}

function fieldValue(value, kind, field) {
  if (kind === 'boolean') {
    if (typeof value !== 'boolean') invalid(field);
  } else if (kind === 'list') {
    if (!Array.isArray(value) || value.length > 50) invalid(field);
    return value.map(item => fieldValue(item, 'text', field));
  } else if (typeof value !== 'string' || value.length > (kind === 'name' ? 200 : 4000)) {
    invalid(field);
  }
  return value;
}

function defaultFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, kind]) =>
    [key, kind === 'list' ? [] : kind === 'boolean' ? false : '']));
}

export function normalizeVisualBible(project) {
  const bible = project?.visualBible;
  if (bible != null) return typeof bible.toObject === 'function' ? bible.toObject() : structuredClone(bible);
  return {
    status: 'empty', schemaVersion: 1, revision: 0, editVersion: 0,
    sourceScriptRevision: null, updatedAt: null, confirmedAt: null,
    visualStyle: defaultFields(styleFields), continuityRules: [],
    visualModes: [], characters: [], locations: [], objects: [],
  };
}

// A full content replacement: top-level sections are required; omitted entity
// fields receive empty defaults. Metadata is never accepted from the client.
export function validateVisualBibleContent(input, currentBible) {
  object(input, contentFields, 'content');
  if (contentFields.some(key => !Object.hasOwn(input, key))) invalid('content');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 80000) invalid('content.size');
  object(input.visualStyle, Object.keys(styleFields), 'visualStyle');
  const content = { visualStyle: defaultFields(styleFields) };
  for (const [key, value] of Object.entries(input.visualStyle)) {
    content.visualStyle[key] = fieldValue(value, styleFields[key], `visualStyle.${key}`);
  }
  content.continuityRules = fieldValue(input.continuityRules, 'list', 'continuityRules');
  for (const [key, spec] of Object.entries(collections)) {
    const values = input[key];
    if (!Array.isArray(values) || values.length > spec.max) invalid(key);
    content[key] = values.map(item => {
      object(item, ['id', ...Object.keys(spec.fields)], key);
      const result = defaultFields(spec.fields);
      for (const [field, value] of Object.entries(item)) {
        if (field !== 'id') result[field] = fieldValue(value, spec.fields[field], `${key}.${field}`);
      }
      if (Object.hasOwn(item, 'id')) result.id = item.id;
      return result;
    });
  }
  return assignStableEntityIds(content, currentBible);
}

export function assignStableEntityIds(content, currentBible) {
  const result = structuredClone(content);
  for (const [key, { prefix }] of Object.entries(collections)) {
    const existing = new Set((currentBible?.[key] || []).map(item => item.id));
    const seen = new Set();
    for (const item of result[key]) {
      if (Object.hasOwn(item, 'id')) {
        if (typeof item.id !== 'string' ||
            !new RegExp(`^${prefix}_${uuidPattern}$`).test(item.id) ||
            !existing.has(item.id)) invalid(`${key}.id`);
      } else {
        do { item.id = `${prefix}_${randomUUID()}`; } while (existing.has(item.id) || seen.has(item.id));
      }
      if (seen.has(item.id)) invalid(`${key}.id`);
      seen.add(item.id);
    }
  }
  return result;
}

// Pipeline stage: evaluated against the document at write time, not a stale
// application snapshot. An absent/empty Bible stays absent/empty.
export function markVisualBibleStaleUpdate() {
  return { $set: { visualBible: { $cond: [
    { $in: ['$visualBible.status', ['draft', 'confirmed', 'stale']] },
    { $mergeObjects: ['$visualBible', {
      status: 'stale', confirmedAt: null, updatedAt: '$$NOW',
      editVersion: { $add: [{ $ifNull: ['$visualBible.editVersion', 0] }, 1] },
    }] },
    { $cond: [{ $eq: [{ $type: '$visualBible' }, 'missing'] }, '$$REMOVE', '$visualBible'] },
  ] } } };
}
