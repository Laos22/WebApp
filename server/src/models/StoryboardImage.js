import mongoose from "mongoose";

const storyboardImageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  frameId: { type: String, required: true, maxlength: 80 },
  sourceStoryboardRevision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  sourcePrompt: { type: String, required: true, maxlength: 12000 },
  sourceReferenceIds: { type: [{ type: String, maxlength: 80 }], default: [] },
  status: { type: String, enum: ["pending", "generating", "ready", "error"], default: "pending" },
  storageKey: { type: String, default: "", select: false },
  mimeType: { type: String, enum: ["", "image/png", "image/jpeg", "image/webp"], default: "" },
  byteSize: { type: Number, default: 0, min: 0, max: 15728640 },
  profileId: { type: String, default: "", maxlength: 80 },
  model: { type: String, default: "", maxlength: 200 },
  errorCode: { type: String, default: "", maxlength: 120 },
  generatedAt: { type: Date, default: null },
}, { timestamps: true });

storyboardImageSchema.index({ projectId: 1, frameId: 1 }, { unique: true });

export default mongoose.model("StoryboardImage", storyboardImageSchema);
