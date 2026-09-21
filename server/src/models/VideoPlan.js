import mongoose from 'mongoose';
const integer = { type: Number, min: 0, default: 0, validate: Number.isSafeInteger };
const frameSchema = new mongoose.Schema({
  frameId: { type: String, required: true, maxlength: 80 },
  selected: { type: Boolean, default: false },
  videoPrompt: { type: String, default: '', maxlength: 12000 },
  promptStatus: { type: String, enum: ['pending', 'ready', 'error'], default: 'pending' },
  promptErrorCode: { type: String, default: '', maxlength: 120 },
  promptUpdatedAt: { type: Date, default: null },
}, { _id: false, strict: 'throw' });
export const videoPlanSchema = new mongoose.Schema({
  status: { type: String, enum: ['empty', 'draft', 'confirmed', 'stale'], default: 'empty' },
  revision: integer, editVersion: integer,
  sourceStoryboardRevision: { ...integer, default: null, validate: value => value === null || Number.isSafeInteger(value) },
  sourceStoryboardFingerprint: { type: String, default: "", maxlength: 64 },
  instructions: { type: String, default: '', maxlength: 4000 },
  updatedAt: { type: Date, default: null }, confirmedAt: { type: Date, default: null },
  frames: { type: [frameSchema], default: [], validate: frames => frames.length <= 1000 &&
    new Set(frames.map(frame => frame.frameId)).size === frames.length },
}, { _id: false, strict: 'throw' });
