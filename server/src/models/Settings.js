import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  apiKey: {
    type: String,
    default: ""
  },
  systemPrompt: {
    type: String,
    default: "Ты — профессиональный YouTube-сценарист. Твоя задача — создавать виральные сценарии."
  },
  driveTokens: {
    type: Object,
    default: null
  },
  driveFileId: {
    type: String,
    default: null
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const Settings = mongoose.model('Settings', settingsSchema);
export default Settings;
