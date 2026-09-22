// server/src/models/Project.js
import mongoose from 'mongoose';
import { videoPlanSchema } from './VideoPlan.js';

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

const voiceoverBlockSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 80 },
  order: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  sourceTitle: { type: String, default: '', maxlength: 500 },
  sourceText: { type: String, required: true, maxlength: 50000 },
  adaptedText: { type: String, required: true, maxlength: 50000 },
  textRevision: { type: Number, min: 1, default: 1, validate: Number.isSafeInteger },
  audioStatus: {
    type: String, enum: ['pending', 'ready', 'stale', 'error'], default: 'pending',
  },
  audioStorageKey: { type: String, default: '', maxlength: 1000, select: false },
  audioMimeType: { type: String, default: '', maxlength: 100 },
  audioDurationSec: { type: Number, min: 0, default: null },
  audioByteSize: { type: Number, min: 0, default: 0 },
  audioProfileId: { type: String, default: '', maxlength: 80 },
  audioGeneratedAt: { type: Date, default: null },
  audioErrorCode: { type: String, default: '', maxlength: 100 },
}, { _id: false, strict: 'throw' });

const voiceoverSchema = new mongoose.Schema({
  status: { type: String, enum: ['empty', 'draft', 'confirmed', 'stale'], default: 'empty' },
  revision: integer(0, 0), editVersion: integer(0, 0),
  sourceScriptRevision: {
    type: Number, default: null, min: 1,
    validate: value => value === null || Number.isSafeInteger(value),
  },
  instructions: { type: String, default: '', maxlength: 4000 },
  blocks: {
    type: [voiceoverBlockSchema], default: [],
    validate: value => value.length <= 200 &&
      new Set(value.map(block => block.id)).size === value.length &&
      value.every((block, index) => block.order === index + 1),
  },
  updatedAt: { type: Date, default: null },
  confirmedAt: { type: Date, default: null },
}, { _id: false, strict: 'throw' });

const soundEffectSchema = new mongoose.Schema({
  _id: { type: String, required: true, maxlength: 36 },
  name: { type: String, required: true, maxlength: 120 },
  prompt: { type: String, required: true, maxlength: 450 },
  durationSec: { type: Number, min: 0.5, max: 30, default: null },
  loop: { type: Boolean, default: false },
  promptInfluence: { type: Number, min: 0, max: 1, default: 0.3 },
  status: { type: String, enum: ['generating', 'ready', 'error'], default: 'generating' },
  storageKey: { type: String, default: '', maxlength: 1000, select: false },
  filename: { type: String, default: '', maxlength: 240 },
  mimeType: { type: String, default: 'audio/mpeg', maxlength: 80 },
  byteSize: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
  generatedAt: { type: Date, default: null },
  errorCode: { type: String, default: '', maxlength: 120 },
}, { timestamps: true, strict: 'throw' });

const storyboardFrameSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 80 },
  order: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  sourceVoiceoverBlockId: { type: String, required: true, maxlength: 80 },
  animation: { type: String, enum: ['', 'Zoom In', 'Zoom Out', 'Pan Left', 'Pan Right', 'Pan Up', 'Pan Down'], default: '' },
  marker: { type: String, maxlength: 2000, default: '' },
  scriptText: { type: String, required: true, maxlength: 4000 },
  visualDescription: { type: String, required: true, maxlength: 4000 },
  prompt: { type: String, required: true, maxlength: 12000 },
  referenceIds: {
    type: [{ type: String, maxlength: 80 }], default: [],
    validate: value => value.length <= 100 && new Set(value).size === value.length,
  },
  promptDetailStatus: {
    type: String, enum: ['pending', 'ready', 'error'], default: 'pending',
  },
  promptDetailedAt: { type: Date, default: null },
  promptDetailErrorCode: { type: String, default: '', maxlength: 120 },
}, { _id: false, strict: 'throw' });

const storyboardSchema = new mongoose.Schema({
  status: { type: String, enum: ['empty', 'draft', 'confirmed', 'stale'], default: 'empty' },
  revision: integer(0, 0), editVersion: integer(0, 0),
  sourceScriptRevision: {
    type: Number, default: null, min: 1,
    validate: value => value === null || Number.isSafeInteger(value),
  },
  sourceReferencePlanRevision: {
    type: Number, default: null, min: 1,
    validate: value => value === null || Number.isSafeInteger(value),
  },
  sourceVoiceoverRevision: {
    type: Number, default: null, min: 1,
    validate: value => value === null || Number.isSafeInteger(value),
  },
  instructions: { type: String, default: '', maxlength: 4000 },
  frames: {
    type: [storyboardFrameSchema], default: [],
    validate: value => value.length <= 200 &&
      new Set(value.map(frame => frame.id)).size === value.length &&
      value.every((frame, index) => frame.order === index + 1),
  },
  updatedAt: { type: Date, default: null }, confirmedAt: { type: Date, default: null },
}, { _id: false, strict: 'throw' });

const projectStorageSchema = new mongoose.Schema({
  provider: { type: String, enum: ["local", "google_drive"], default: "local" },
  driveRootFolderId: { type: String, default: "", maxlength: 300 },
  driveFolderIds: {
    audio: { type: String, default: "", maxlength: 300 },
    images: { type: String, default: "", maxlength: 300 },
    video: { type: String, default: "", maxlength: 300 },
    cover: { type: String, default: "", maxlength: 300 },
    script: { type: String, default: "", maxlength: 300 },
    references: { type: String, default: "", maxlength: 300 },
    packages: { type: String, default: "", maxlength: 300 },
  },
}, { _id: false, strict: "throw" });

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
  storage: { type: projectStorageSchema, default: () => ({ provider: "local" }) },
  script: { type: scriptSchema, default: undefined },
  voiceover: { type: voiceoverSchema, default: undefined },
  soundEffects: { type: [soundEffectSchema], default: [] },
  visualBible: { type: visualBibleSchema, default: undefined },
  referencePlan: { type: referencePlanSchema, default: undefined },
  storyboard: { type: storyboardSchema, default: undefined },
  videoPlan: { type: videoPlanSchema, default: undefined },
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

projectSchema.set("toJSON", {
  transform(_document, result) {
    delete result.projectPath;
    if (result.storage) result.storage = { provider: result.storage.provider || "local" };
    return result;
  },
});

const Project = mongoose.model('Project', projectSchema);
export default Project;
