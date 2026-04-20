const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  sources: [{
    documentId: String,
    fileName: String,
    pageNumber: Number,
    excerpt: String,
    similarity: Number
  }],
  metadata: {
    tokens: Number,
    model: String,
    processingTime: Number
  }
}, { timestamps: true });

const chatSchema = new mongoose.Schema({
  title: {
    type: String,
    default: 'New Chat'
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  document: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    default: null
  },
  messages: [messageSchema],
  isArchived: {
    type: Boolean,
    default: false
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    default: null
  }
}, {
  timestamps: true
});

chatSchema.index({ user: 1, lastMessageAt: -1 });
chatSchema.index({ user: 1, document: 1 });

module.exports = mongoose.model('Chat', chatSchema);
