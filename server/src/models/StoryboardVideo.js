import mongoose from 'mongoose';
const text = max => ({ type: String, default: '', maxlength: max });
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true },
  frameId: { type: String, required: true, maxlength: 80 },
  status: { type: String, enum: ['pending', 'generating', 'ready', 'stale', 'error'], default: 'pending' },
  storageKey: { ...text(1000), select: false },
  mimeType: { type: String, enum: ['', 'video/mp4'], default: '' },
  filename: text(200), byteSize: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
  durationSec: { type: Number, min: 0, default: null },
  width: { type: Number, min: 1, default: null, validate: v => v === null || Number.isSafeInteger(v) },
  height: { type: Number, min: 1, default: null, validate: v => v === null || Number.isSafeInteger(v) },
  generationProfileId: text(80), provider: text(100), operationId: text(1000),
  inputFingerprint: text(64), errorCode: text(120), generatedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });
schema.index({ userId: 1, projectId: 1, frameId: 1 }, { unique: true });
export default mongoose.model('StoryboardVideo', schema);
