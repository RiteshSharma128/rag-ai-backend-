const express = require('express');
const router = express.Router();
const {
  uploadDocument, getDocuments, getDocument,
  getDocumentStatus, deleteDocument, updateDocument
} = require('../controllers/documentController');
const { protect } = require('../middleware/auth');
const { uploadPDF } = require('../middleware/upload');

router.use(protect);

router.post('/upload', uploadPDF.single('file'), uploadDocument);
router.get('/', getDocuments);
router.get('/:id', getDocument);
router.get('/:id/status', getDocumentStatus);
router.put('/:id', updateDocument);
router.delete('/:id', deleteDocument);

module.exports = router;
