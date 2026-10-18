import mongoose from 'mongoose';

const shotSchema = new mongoose.Schema({
  frameId: { type: String, required: true, maxlength: 80 },
  horizontalOffset: { type: Number, min: -40, max: 40, default: 0 },
  durationWeight: { type: Number, min: 1, max: 5, default: 1 },
}, { _id: false, strict: 'throw' });

const shortVideoSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true },
  title: { type: String, required: true, maxlength: 120 },
  hook: { type: String, default: '', maxlength: 500 },
  narration: { type: String, required: true, maxlength: 3000 },
  shots: { type: [shotSchema], required: true,
    validate: value => value.length >= 1 && value.length <= 24 && new Set(value.map(shot => shot.frameId)).size === value.length },
  sourceStoryboardRevision: { type: Number, required: true, min: 1 },
  version: { type: Number, default: 1, min: 1 },
  narrationRevision: { type: Number, default: 1, min: 1 },
  audio: { type: new mongoose.Schema({
    status: { type: String, enum: ['empty', 'ready', 'stale'], default: 'empty' },
    storageKey: { type: String, default: '', select: false },
    filename: { type: String, default: '' },
    durationSec: { type: Number, min: 0, default: null },
    textRevision: { type: Number, min: 1, default: null },
    generatedAt: { type: Date, default: null },
  }, { _id: false, strict: 'throw' }), default: () => ({ status: 'empty' }) },
}, { timestamps: true, strict: 'throw' });

shortVideoSchema.index({ userId: 1, projectId: 1, createdAt: -1 });
export default mongoose.model('ShortVideo', shortVideoSchema);
