const Chat = require('../models/Chat');
const Document = require('../models/Document');
const Meeting = require('../models/Meeting');
const User = require('../models/User');
const { cacheGet, cacheSet } = require('../config/redis');

// @GET /api/analytics/dashboard
const getDashboard = async (req, res) => {
  try {
    const cacheKey = `analytics:dashboard:${req.user._id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ success: true, data: cached, cached: true });

    const userId = req.user._id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalChats,
      totalDocuments,
      totalMeetings,
      recentChats,
      recentMeetings,
      chatsByDay,
      meetingsByDay
    ] = await Promise.all([
      Chat.countDocuments({ user: userId }),
      Document.countDocuments({ user: userId }),
      Meeting.countDocuments({ $or: [{ host: userId }, { 'participants.user': userId }] }),
      Chat.countDocuments({ user: userId, createdAt: { $gte: sevenDaysAgo } }),
      Meeting.countDocuments({
        $or: [{ host: userId }, { 'participants.user': userId }],
        createdAt: { $gte: sevenDaysAgo }
      }),
      // Chats per day (last 7 days)
      Chat.aggregate([
        { $match: { user: userId, createdAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { '_id': 1 } }
      ]),
      // Meetings per day
      Meeting.aggregate([
        { $match: { host: userId, createdAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { '_id': 1 } }
      ])
    ]);

    // Total messages sent
    const messageStats = await Chat.aggregate([
      { $match: { user: userId } },
      { $unwind: '$messages' },
      { $match: { 'messages.role': 'user' } },
      { $group: { _id: null, total: { $sum: 1 } } }
    ]);
    const totalMessages = messageStats[0]?.total || 0;

    // Average meeting duration
    const meetingDurationStats = await Meeting.aggregate([
      { $match: { host: userId, status: 'ended', duration: { $exists: true } } },
      { $group: { _id: null, avgDuration: { $avg: '$duration' }, totalTime: { $sum: '$duration' } } }
    ]);

    const data = {
      overview: {
        totalChats,
        totalDocuments,
        totalMeetings,
        totalMessages,
        recentChats,
        recentMeetings,
        avgMeetingDuration: Math.round((meetingDurationStats[0]?.avgDuration || 0) / 60), // minutes
        totalMeetingTime: Math.round((meetingDurationStats[0]?.totalTime || 0) / 3600) // hours
      },
      charts: {
        chatsByDay,
        meetingsByDay
      }
    };

    await cacheSet(cacheKey, data, 300); // Cache 5 min
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/analytics/team (admin only)
const getTeamDashboard = async (req, res) => {
  try {
    const tenantId = req.user.tenant;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'No tenant found' });
    }

    const cacheKey = `analytics:team:${tenantId}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ success: true, data: cached, cached: true });

    const [
      totalUsers,
      activeUsers,
      topUsers,
      recentMeetings
    ] = await Promise.all([
      User.countDocuments({ tenant: tenantId }),
      User.countDocuments({ tenant: tenantId, lastSeen: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
      // Top users by activity
      Chat.aggregate([
        { $match: { tenant: tenantId } },
        { $group: { _id: '$user', chatCount: { $sum: 1 } } },
        { $sort: { chatCount: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { 'user.name': 1, 'user.avatar': 1, chatCount: 1 } }
      ]),
      Meeting.find({ tenant: tenantId, status: 'ended' })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('host', 'name')
        .select('title duration meetingScore startTime')
    ]);

    const data = { totalUsers, activeUsers, topUsers, recentMeetings };
    await cacheSet(cacheKey, data, 300);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/analytics/productivity
const getProductivityStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const meetings = await Meeting.find({
      host: userId,
      status: 'ended',
      createdAt: { $gte: sevenDaysAgo }
    }).select('meetingScore duration title startTime');

    const avgScore = meetings.length > 0
      ? meetings.reduce((sum, m) => sum + (m.meetingScore?.overall || 0), 0) / meetings.length
      : 0;

    const productivityData = {
      avgMeetingScore: Math.round(avgScore * 10) / 10,
      meetings: meetings.map(m => ({
        title: m.title,
        date: m.startTime,
        score: m.meetingScore?.overall || 0,
        duration: Math.round((m.duration || 0) / 60)
      }))
    };

    res.json({ success: true, data: productivityData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getDashboard, getTeamDashboard, getProductivityStats };
