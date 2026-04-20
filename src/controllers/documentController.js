const Document = require('../models/Document');
const { processDocument, deleteDocumentVectors } = require('../services/ragService');
const { cacheGet, cacheSet, cacheDel } = require('../config/redis');
const fs = require('fs');
const path = require('path');

// @POST /api/documents/upload
const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const fileExt = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    
    const document = await Document.create({
      name: req.body.name || req.file.originalname,
      originalName: req.file.originalname,
      fileType: fileExt,
      filePath: req.file.path,
      fileSize: req.file.size,
      user: req.user._id,
      tenant: req.user.tenant || null,
      status: 'processing'
    });

    // Process async - don't block response
    processDocument(document._id.toString(), req.file.path, fileExt)
      .then(async ({ totalChunks, totalPages, collectionName }) => {
        await Document.findByIdAndUpdate(document._id, {
          status: 'ready',
          totalChunks,
          totalPages,
          vectorCollectionId: collectionName
        });
        await cacheDel(`docs:${req.user._id}`);
      })
      .catch(async (err) => {
        console.error('Document processing error:', err);
        await Document.findByIdAndUpdate(document._id, {
          status: 'error',
          errorMessage: err.message
        });
      });

    res.status(201).json({
      success: true,
      message: 'Document uploaded. Processing started...',
      document
    });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/documents
const getDocuments = async (req, res) => {
  try {
    const cacheKey = `docs:${req.user._id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ success: true, documents: cached, cached: true });

    const documents = await Document.find({ user: req.user._id })
      .select('-filePath')
      .sort({ createdAt: -1 });

    await cacheSet(cacheKey, documents, 60);
    res.json({ success: true, documents });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/documents/:id
const getDocument = async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    res.json({ success: true, document });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/documents/:id/status - poll processing status
const getDocumentStatus = async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      user: req.user._id
    }).select('status totalChunks totalPages errorMessage');

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    res.json({ success: true, ...document.toObject() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @DELETE /api/documents/:id
const deleteDocument = async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // Delete file from disk
    if (document.filePath && fs.existsSync(document.filePath)) {
      fs.unlinkSync(document.filePath);
    }

    // Delete vectors from ChromaDB
    if (document.vectorCollectionId) {
      await deleteDocumentVectors(document.vectorCollectionId);
    }

    await document.deleteOne();
    await cacheDel(`docs:${req.user._id}`);

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @PUT /api/documents/:id
const updateDocument = async (req, res) => {
  try {
    const { name, tags, isPublic } = req.body;
    
    const document = await Document.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { name, tags, isPublic },
      { new: true, runValidators: true }
    );

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    await cacheDel(`docs:${req.user._id}`);
    res.json({ success: true, document });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  uploadDocument,
  getDocuments,
  getDocument,
  getDocumentStatus,
  deleteDocument,
  updateDocument
};
