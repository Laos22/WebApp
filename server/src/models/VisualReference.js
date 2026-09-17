import mongoose from "mongoose";

const visualReferenceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  referenceId: { type: String, required: true, maxlength: 80 },
  // Kept for compatibility with the unique index created by the previous release.
  entityCollection: { type: String, default: "references", select: false },
  entityId: { type: String, required: true, maxlength: 80, select: false },
  sourceReferenceVersion: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  status: { type: String, enum: ["loading", "ready", "error"], default: "ready" },
  storageKey: { type: String, required: true, select: false },
  mimeType: { type: String, enum: ["image/png", "image/jpeg", "image/webp"], required: true },
  byteSize: { type: Number, required: true, min: 1, max: 15728640 },
  prompt: { type: String, required: true, maxlength: 12000 },
  errorCode: { type: String, default: "", maxlength: 80 },
}, { timestamps: true });

visualReferenceSchema.index(
  { projectId: 1, referenceId: 1 },
  { unique: true, partialFilterExpression: { referenceId: { $type: "string" } } },
);

export default mongoose.model("VisualReference", visualReferenceSchema);
