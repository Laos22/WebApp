import mongoose from "mongoose";

const visualReferenceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  entityCollection: { type: String, enum: ["characters", "locations", "objects"], required: true },
  entityId: { type: String, required: true, maxlength: 80 },
  sourceBibleRevision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  sourceBibleEditVersion: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  status: { type: String, enum: ["loading", "ready", "error"], default: "ready" },
  storageKey: { type: String, required: true, select: false },
  mimeType: { type: String, enum: ["image/png", "image/jpeg", "image/webp"], required: true },
  byteSize: { type: Number, required: true, min: 1, max: 15728640 },
  prompt: { type: String, required: true, maxlength: 12000 },
  errorCode: { type: String, default: "", maxlength: 80 },
}, { timestamps: true });

visualReferenceSchema.index({ projectId: 1, entityCollection: 1, entityId: 1 }, { unique: true });

export default mongoose.model("VisualReference", visualReferenceSchema);