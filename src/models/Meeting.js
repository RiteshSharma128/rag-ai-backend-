const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  host: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  participants: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    joinedAt: Date,
    leftAt: Date,
    role: { type: String, enum: ['host', 'participant'], default: 'participant' }
  }],
  roomId: {
    type: String,
    unique: true,
    required: true
  },
  status: {
    type: String,
    enum: ['scheduled', 'live', 'ended'],
    default: 'scheduled'
  },
  startTime: Date,
  endTime: Date,
  duration: Number, // in seconds
  
  // Recording
  recording: {
    isRecording: { type: Boolean, default: false },
    recordingUrl: String,
    recordingSize: Number
  },

  // AI Analysis
  transcript: [{
    speaker: String,
    text: String,
    timestamp: Number,
    emotion: String
  }],
  summary: String,
  actionItems: [{
    task: String,
    assignee: String,
    dueDate: Date,
    status: { type: String, enum: ['pending', 'done'], default: 'pending' }
  }],
  highlights: [String],
  sentiment: {
    overall: String,
    score: Number
  },
  meetingScore: {
    engagement: Number,
    productivity: Number,
    overall: Number
  },

  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Meeting', meetingSchema);
