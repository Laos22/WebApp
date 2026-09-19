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

function invalidGeneratedResponse(fields) {
  const error = new Error('Некорректный ответ Visual Bible');
  error.status = 502;
  error.code = 'INVALID_VISUAL_BIBLE_RESPONSE';
  error.fields = fields;
  throw error;
}

function isGeneratedObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function generatedText(value) {
  return ['string', 'number', 'boolean'].includes(typeof value) ? String(value).trim() : '';
}

function generatedList(value) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return items.map(generatedText).filter(Boolean);
}

// Compatibility aliases apply only to generated content, never manual PUT validation.
const generatedAliases = {
  visualStyle: ['visual_style', 'global_style'],
  visualModes: ['visual_modes'],
  continuityRules: ['continuity_rules', 'continuity_rules_ru'],
  concept: ['concept_ru'], colorPalette: ['color_palette'],
  lightingRules: ['lighting_rules'], cameraRules: ['camera_rules'],
  textureRules: ['texture_rules'], promptAnchorEn: ['prompt_anchor_en'], avoid: ['avoid_en'],
  name: ['name_ru'], sourceFacts: ['source_facts', 'source_facts_ru'],
  designDecisions: ['design_decisions', 'design_decisions_ru'], role: ['role_ru'],
  identityAnchorEn: ['identity_anchor_en'], defaultWardrobeEn: ['default_wardrobe_en'],
  optionalPropsEn: ['optional_props_en'], variableConditionsEn: ['variable_conditions_en'],
  visualAnchorEn: ['visual_anchor_en'], purpose: ['purpose_ru'], styleEn: ['style_en'],
  paletteEn: ['palette_en'], lightingOptionsEn: ['lighting_options_en'],
  cameraOptionsEn: ['camera_options_en'], atmosphereOptionsEn: ['atmosphere_options_en'],
  avoidEn: ['avoid_en'],
};

function generatedKey(input, key) {
  return [key, ...(generatedAliases[key] || [])].find(candidate => Object.hasOwn(input, candidate));
}

function generatedValue(input, key) {
  const selected = generatedKey(input, key);
  return selected === undefined ? undefined : input[selected];
}

function generatedFields(input, fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, kind]) => {
    const value = generatedValue(input, key);
    return [key, kind === 'list' ? generatedList(value)
      : kind === 'boolean' ? (typeof value === 'boolean' ? value : false)
        : generatedText(value)];
  }));
}

function parseGeneratedVisualBible(rawResponse) {
  let input = rawResponse;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    try {
      input = JSON.parse((fenced ? fenced[1] : trimmed).trim());
    } catch {
      invalidGeneratedResponse(['$']);
    }
  }
  if (!isGeneratedObject(input)) invalidGeneratedResponse(['$']);
  if (!contentFields.some(key => generatedKey(input, key) !== undefined)) {
    for (const wrapper of ['content', 'visualBible', 'visual_bible']) {
      if (Object.hasOwn(input, wrapper)) {
        if (!isGeneratedObject(input[wrapper])) invalidGeneratedResponse([wrapper]);
        input = input[wrapper];
        break;
      }
    }
  }
  return input;
}

// Generated content only: metadata and provider IDs never cross this boundary.
export function normalizeGeneratedVisualBible(rawResponse) {
  const input = parseGeneratedVisualBible(rawResponse);

  const fields = [];
  const style = generatedValue(input, 'visualStyle');
  if (style != null && !isGeneratedObject(style)) fields.push('visualStyle');
  const result = {
    visualStyle: generatedFields(isGeneratedObject(style) ? style : {}, styleFields),
    visualModes: [],
    continuityRules: generatedList(generatedValue(input, 'continuityRules')),
    characters: [],
    locations: [],
    objects: [],
  };
  for (const [key, spec] of Object.entries(collections)) {
    const values = generatedValue(input, key);
    if (values == null) continue;
    if (!Array.isArray(values)) {
      fields.push(key);
      continue;
    }
    result[key] = values.filter(isGeneratedObject).map(item => generatedFields(item, spec.fields));
  }
  if (fields.length) invalidGeneratedResponse(fields);
  return result;
}

export function normalizeEditedVisualBible(rawResponse, currentBible) {
  const input = parseGeneratedVisualBible(rawResponse);
  const missingContent = contentFields.filter(key => generatedKey(input, key) === undefined);
  if (missingContent.length) invalidGeneratedResponse(missingContent);
  const fields = [];
  const style = generatedValue(input, 'visualStyle');
  if (style != null && !isGeneratedObject(style)) fields.push('visualStyle');
  const result = {
    visualStyle: generatedFields(isGeneratedObject(style) ? style : {}, styleFields),
    visualModes: [],
    continuityRules: generatedList(generatedValue(input, 'continuityRules')),
    characters: [],
    locations: [],
    objects: [],
  };
  const usedIds = new Set();
  const allExistingIds = new Set(Object.keys(collections).flatMap(key =>
    (currentBible?.[key] || []).map(item => item.id)));
  for (const [key, spec] of Object.entries(collections)) {
    const values = generatedValue(input, key);
    if (values == null) continue;
    if (!Array.isArray(values) || values.some(item => !isGeneratedObject(item))) {
      fields.push(key);
      continue;
    }
    const existingIds = new Set((currentBible?.[key] || []).map(item => item.id));
    result[key] = values.map(item => {
      const normalized = generatedFields(item, spec.fields);
      if (Object.hasOwn(item, 'id')) {
        if (typeof item.id !== 'string' || !existingIds.has(item.id) || usedIds.has(item.id) || !allExistingIds.has(item.id)) {
          fields.push(`${key}.id`);
        } else {
          normalized.id = item.id;
          usedIds.add(item.id);
        }
      }
      return normalized;
    });
  }
  if (fields.length) invalidGeneratedResponse([...new Set(fields)]);
  return result;
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
export function validateVisualBibleContent(input, currentBible, { assignNewIds = true } = {}) {
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
  return assignStableEntityIds(content, currentBible, { assignNewIds });
}

export function assignStableEntityIds(content, currentBible, { assignNewIds = true } = {}) {
  const result = structuredClone(content);
  for (const [key, { prefix }] of Object.entries(collections)) {
    const existing = new Set((currentBible?.[key] || []).map(item => item.id));
    const seen = new Set();
    for (const item of result[key]) {
      if (Object.hasOwn(item, 'id')) {
        if (typeof item.id !== 'string' ||
            !new RegExp(`^${prefix}_${uuidPattern}$`).test(item.id) ||
            !existing.has(item.id)) invalid(`${key}.id`);
      } else if (assignNewIds) {
        do { item.id = `${prefix}_${randomUUID()}`; } while (existing.has(item.id) || seen.has(item.id));
      }
      if (Object.hasOwn(item, 'id')) {
        if (seen.has(item.id)) invalid(`${key}.id`);
        seen.add(item.id);
      }
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
  ] }, referencePlan: { $cond: [
    { $in: ['$referencePlan.status', ['draft', 'confirmed', 'stale']] },
    { $mergeObjects: ['$referencePlan', {
      status: 'stale', confirmedAt: null, updatedAt: '$$NOW',
      editVersion: { $add: [{ $ifNull: ['$referencePlan.editVersion', 0] }, 1] },
    }] },
    { $cond: [{ $eq: [{ $type: '$referencePlan' }, 'missing'] }, '$$REMOVE', '$referencePlan'] },
  ] }, voiceover: { $cond: [
    { $in: ['$voiceover.status', ['draft', 'confirmed', 'stale']] },
    { $mergeObjects: ['$voiceover', {
      status: 'stale', confirmedAt: null, updatedAt: '$$NOW',
      editVersion: { $add: [{ $ifNull: ['$voiceover.editVersion', 0] }, 1] },
    }] },
    { $cond: [{ $eq: [{ $type: '$voiceover' }, 'missing'] }, '$$REMOVE', '$voiceover'] },
  ] }, storyboard: { $cond: [
    { $in: ['$storyboard.status', ['draft', 'confirmed', 'stale']] },
    { $mergeObjects: ['$storyboard', {
      status: 'stale', confirmedAt: null, updatedAt: '$$NOW',
      editVersion: { $add: [{ $ifNull: ['$storyboard.editVersion', 0] }, 1] },
    }] },
    { $cond: [{ $eq: [{ $type: '$storyboard' }, 'missing'] }, '$$REMOVE', '$storyboard'] },
  ] } } };
}
