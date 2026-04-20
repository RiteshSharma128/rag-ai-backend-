const express = require('express');
const router = express.Router();
const {
  createMeeting, getMeetings, getMeeting,
  joinMeeting, endMeeting, addTranscript,
  analyzeMeeting, getMeetingSummary
} = require('../controllers/meetingController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.post('/', createMeeting);
router.get('/', getMeetings);
router.get('/:roomId', getMeeting);
router.post('/:roomId/join', joinMeeting);
router.post('/:roomId/end', endMeeting);
router.post('/:id/transcript', addTranscript);
router.post('/:id/analyze', analyzeMeeting);
router.get('/:id/summary', getMeetingSummary);

module.exports = router;
