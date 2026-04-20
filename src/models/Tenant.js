const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  plan: {
    type: String,
    enum: ['free', 'pro', 'enterprise'],
    default: 'free'
  },
  settings: {
    maxUsers: { type: Number, default: 5 },
    maxDocuments: { type: Number, default: 10 },
    maxStorageGB: { type: Number, default: 1 }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  logo: String
}, {
  timestamps: true
});

module.exports = mongoose.model('Tenant', tenantSchema);
