const express = require('express');
const router = express.Router();
const {
  createChat, getChats, getChat,
  sendMessage, sendMessageStream,
  deleteChat, archiveChat, updateChatTitle
} = require('../controllers/chatController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.post('/', createChat);
router.get('/', getChats);
router.get('/:id', getChat);
router.post('/:id/message', sendMessage);
router.post('/:id/message/stream', sendMessageStream);
router.put('/:id/title', updateChatTitle);
router.put('/:id/archive', archiveChat);
router.delete('/:id', deleteChat);

module.exports = router;
