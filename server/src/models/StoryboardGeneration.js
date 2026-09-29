import mongoose from 'mongoose';
import { MAX_STORYBOARD_FRAMES } from '../constants/projectLimits.js';

const schema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  runId: { type: String, required: true },
  status: { type: String, enum: ['queued', 'running', 'failed', 'completed'], required: true },
  total: { type: Number, min: 1, max: MAX_STORYBOARD_FRAMES, required: true },
  completed: { type: Number, default: 0 },
  profileId: { type: String, default: '' },
  // No credentials are stored in jobs; the worker reads the owner's profile.
  input: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  frames: { type: [mongoose.Schema.Types.Mixed], default: [], select: false },
  leaseToken: { type: String, default: '' },
  leaseUntil: { type: Date, default: null },
  errorCode: { type: String, default: '' },
}, { timestamps: true });
schema.index({ status: 1, leaseUntil: 1 });

export default mongoose.model('StoryboardGeneration', schema);
