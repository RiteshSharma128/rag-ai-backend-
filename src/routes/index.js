const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const documentRoutes = require('./documents');
const chatRoutes = require('./chats');
const meetingRoutes = require('./meetings');
const analyticsRoutes = require('./analytics');
const notificationRoutes = require('./notifications');
const userRoutes = require('./users');

router.use('/auth', authRoutes);
router.use('/documents', documentRoutes);
router.use('/chats', chatRoutes);
router.use('/meetings', meetingRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/users', userRoutes);

module.exports = router;
