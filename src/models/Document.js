const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  originalName: String,
  fileType: {
    type: String,
    enum: ['pdf', 'txt', 'docx', 'md'],
    default: 'pdf'
  },
  filePath: String,
  fileSize: Number,
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant'
  },
  status: {
    type: String,
    enum: ['uploading', 'processing', 'ready', 'error'],
    default: 'uploading'
  },
  // ChromaDB collection ID for this document
  vectorCollectionId: {
    type: String,
    unique: true,
    sparse: true
  },
  totalChunks: {
    type: Number,
    default: 0
  },
  totalPages: {
    type: Number,
    default: 0
  },
  summary: String,
  tags: [String],
  isPublic: {
    type: Boolean,
    default: false
  },
  errorMessage: String,
  metadata: {
    author: String,
    createdDate: Date,
    keywords: [String]
  }
}, {
  timestamps: true
});

documentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Document', documentSchema);
