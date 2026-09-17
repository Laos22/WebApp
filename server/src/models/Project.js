// server/src/models/Project.js
import mongoose from 'mongoose';

const nested = { _id: false, strict: 'throw' };
const text = () => ({ type: String, default: '', maxlength: 4000 });
const strings = () => ({
  type: [{ type: String, maxlength: 4000 }], default: [],
  validate: value => value.length <= 50,
});
const integer = (min, defaultValue) => ({
  type: Number, min, default: defaultValue, validate: Number.isSafeInteger,
});
const entityFields = () => ({
  id: { type: String, required: true, maxlength: 80 },
  name: { type: String, default: '', maxlength: 200 },
});
const facts = () => ({ sourceFacts: strings(), designDecisions: strings() });
const visualStyleSchema = new mongoose.Schema({
  concept: text(), realism: text(), colorPalette: strings(), lightingRules: strings(),
  cameraRules: strings(), textureRules: strings(), promptAnchorEn: text(), avoid: strings(),
}, nested);
const visualModeSchema = new mongoose.Schema({
  ...entityFields(), purpose: text(), styleEn: text(), paletteEn: text(),
  lightingOptionsEn: strings(), cameraOptionsEn: strings(),
  atmosphereOptionsEn: strings(), avoidEn: strings(),
}, nested);
const characterSchema = new mongoose.Schema({
  ...entityFields(), role: text(), recurring: { type: Boolean, default: false }, ...facts(),
  identityAnchorEn: text(), defaultWardrobeEn: text(), optionalPropsEn: strings(),
}, nested);
const locationSchema = new mongoose.Schema({
  ...entityFields(), ...facts(), identityAnchorEn: text(), variableConditionsEn: strings(),
}, nested);
const objectSchema = new mongoose.Schema({
  ...entityFields(), ...facts(), visualAnchorEn: text(),
}, nested);
const entities = (schema, prefix, max) => ({
  type: [schema], default: [],
  validate: value => value.length <= max &&
    new Set(value.map(item => item.id)).size === value.length &&
    value.every(item => new RegExp(`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).test(item.id)),
});
const visualBibleSchema = new mongoose.Schema({
  status: { type: String, enum: ['empty', 'draft', 'confirmed', 'stale'], default: 'empty' },
  schemaVersion: { ...integer(1, 1), enum: [1] },
  revision: integer(0, 0), editVersion: integer(0, 0),
  sourceScriptRevision: {
    type: Number, default: null, min: 1,
    validate: value => value === null || Number.isSafeInteger(value),
  },
  updatedAt: { type: Date, default: null },
  confirmedAt: { type: Date, default: null },
  visualStyle: { type: visualStyleSchema, default: () => ({}) },
  visualModes: entities(visualModeSchema, 'mode', 20),
  continuityRules: strings(),
  characters: entities(characterSchema, 'char', 100),
  locations: entities(locationSchema, 'loc', 100),
  objects: entities(objectSchema, 'obj', 100),
}, nested);

const scriptSchema = new mongoose.Schema({
  content: { type: String, required: true },
  status: { type: String, enum: ['draft', 'confirmed'], default: 'draft' },
  revision: { type: Number, min: 1, required: true },
  generatedAt: { type: Date, required: true },
  confirmedAt: { type: Date, default: null }
}, { _id: false });

const referenceItemSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 80 },
  name: { type: String, required: true, maxlength: 200 },
  type: { type: String, enum: ['character', 'location', 'object', 'other'], default: 'other' },
  description: { type: String, default: '', maxlength: 4000 },
  reason: { type: String, default: '', maxlength: 2000 },
  mentions: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
  prompt: { type: String, default: '', maxlength: 12000 },
  selected: { type: Boolean, default: true },
  version: { type: Number, min: 1, default: 1, validate: Number.isSafeInteger },
}, { _id: false, strict: 'throw' });

const referencePlanSchema = new mongoose.Schema({
  status: { type: String, enum: ['empty', 'draft', 'confirmed', 'stale'], default: 'empty' },
  revision: integer(0, 0),
  editVersion: integer(0, 0),
  sourceScriptRevision: {
    type: Number, default: null, min: 1,
    validate: value => value === null || Number.isSafeInteger(value),
  },
  instructions: { type: String, default: '', maxlength: 4000 },
  items: {
    type: [referenceItemSchema], default: [],
    validate: value => value.length <= 100 && new Set(value.map(item => item.id)).size === value.length,
  },
  updatedAt: { type: Date, default: null },
  confirmedAt: { type: Date, default: null },
}, { _id: false, strict: 'throw' });

const projectSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ""
  },
  videoTopic: {
    type: String,
    default: ""
  },
  videoTopicDescription: {
    type: String,
    default: ""
  },
  shortTitle: {
    type: String,
    default: ""
  },
  // 👈 НОВЫЕ ПОЛЯ
  keywords: {
    type: String,
    default: ""
  },
  projectPath: {
    type: String,
    default: ""
  },
  script: { type: scriptSchema, default: undefined },
  visualBible: { type: visualBibleSchema, default: undefined },
  referencePlan: { type: referencePlanSchema, default: undefined },
  scriptPath: {
    type: String,
    default: ""
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Project = mongoose.model('Project', projectSchema);
export default Project;
