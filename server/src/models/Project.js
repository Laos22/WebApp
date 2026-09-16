// server/src/models/Project.js
import mongoose from 'mongoose';

const scriptSchema = new mongoose.Schema({
  content: { type: String, required: true },
  status: { type: String, enum: ['draft', 'confirmed'], default: 'draft' },
  revision: { type: Number, min: 1, required: true },
  generatedAt: { type: Date, required: true },
  confirmedAt: { type: Date, default: null }
}, { _id: false });

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