import mongoose from 'mongoose';

// One reusable example per user; kept outside Settings so profiles never load image bytes.
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  image: { type: Buffer, required: true, select: false },
  mimeType: { type: String, required: true },
  revision: { type: String, required: true },
  analysis: { type: mongoose.Schema.Types.Mixed, default: null },
  confirmed: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

export default mongoose.model('CoverStyle', schema);
