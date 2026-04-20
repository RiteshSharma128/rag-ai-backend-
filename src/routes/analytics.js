// analytics.js
const express = require('express');
const analyticsRouter = express.Router();
const { getDashboard, getTeamDashboard, getProductivityStats } = require('../controllers/analyticsController');
const { protect, authorize } = require('../middleware/auth');

analyticsRouter.use(protect);
analyticsRouter.get('/dashboard', getDashboard);
analyticsRouter.get('/team', authorize('admin'), getTeamDashboard);
analyticsRouter.get('/productivity', getProductivityStats);

module.exports = analyticsRouter;
