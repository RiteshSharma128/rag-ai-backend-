const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { createNotification } = require('../controllers/notificationController');

const onlineUsers = new Map(); // userId -> { socketId, name, avatar }
const typingUsers = new Map(); // chatId -> Set of userIds
const meetingRooms = new Map(); // roomId -> Set of { userId, socketId, name }

const initSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Auth middleware for socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token ||
        socket.handshake.headers?.cookie?.split('access_token=')[1]?.split(';')[0];

      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('name avatar role');
      if (!user) return next(new Error('User not found'));

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, user } = socket;
    console.log(`🔌 Socket connected: ${user.name} (${userId})`);

    // Mark user online
    onlineUsers.set(userId, {
      socketId: socket.id,
      name: user.name,
      avatar: user.avatar
    });

    await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });

    // Broadcast online users
    io.emit('users:online', Array.from(onlineUsers.entries()).map(([id, u]) => ({ id, ...u })));

    // ─── CHAT EVENTS ─────────────────────────────────────
    
    // Join chat room
    socket.on('chat:join', (chatId) => {
      socket.join(`chat:${chatId}`);
    });

    // Leave chat room
    socket.on('chat:leave', (chatId) => {
      socket.leave(`chat:${chatId}`);
    });

    // Typing indicator
    socket.on('chat:typing', ({ chatId, isTyping }) => {
      if (!typingUsers.has(chatId)) typingUsers.set(chatId, new Set());
      
      if (isTyping) {
        typingUsers.get(chatId).add(userId);
      } else {
        typingUsers.get(chatId).delete(userId);
      }

      socket.to(`chat:${chatId}`).emit('chat:typing', {
        userId,
        name: user.name,
        isTyping,
        typingUsers: Array.from(typingUsers.get(chatId) || [])
      });
    });

    // Real-time message broadcast (after saved to DB)
    socket.on('chat:message', ({ chatId, message }) => {
      socket.to(`chat:${chatId}`).emit('chat:message', {
        chatId,
        message,
        from: { _id: userId, name: user.name, avatar: user.avatar }
      });
    });

    // ─── MEETING / WEBRTC EVENTS ─────────────────────────

    // Join meeting room
    socket.on('meeting:join', ({ roomId }) => {
      socket.join(`meeting:${roomId}`);
      
      if (!meetingRooms.has(roomId)) meetingRooms.set(roomId, new Set());
      meetingRooms.get(roomId).add({ userId, socketId: socket.id, name: user.name, avatar: user.avatar });

      // Notify others
      socket.to(`meeting:${roomId}`).emit('meeting:user-joined', {
        userId,
        name: user.name,
        avatar: user.avatar,
        socketId: socket.id
      });

      // Send current participants to new user
      const participants = Array.from(meetingRooms.get(roomId) || []);
      socket.emit('meeting:participants', participants.filter(p => p.userId !== userId));
    });

    // WebRTC signaling
    socket.on('meeting:offer', ({ targetSocketId, offer, roomId }) => {
      io.to(targetSocketId).emit('meeting:offer', {
        offer,
        fromSocketId: socket.id,
        fromUserId: userId,
        fromName: user.name
      });
    });

    socket.on('meeting:answer', ({ targetSocketId, answer }) => {
      io.to(targetSocketId).emit('meeting:answer', {
        answer,
        fromSocketId: socket.id
      });
    });

    socket.on('meeting:ice-candidate', ({ targetSocketId, candidate }) => {
      io.to(targetSocketId).emit('meeting:ice-candidate', {
        candidate,
        fromSocketId: socket.id
      });
    });

    // Media state changes (mute/unmute/camera)
    socket.on('meeting:media-state', ({ roomId, audio, video, screen }) => {
      socket.to(`meeting:${roomId}`).emit('meeting:media-state', {
        userId,
        audio,
        video,
        screen
      });
    });

    // Screen sharing
    socket.on('meeting:screen-share', ({ roomId, isSharing }) => {
      socket.to(`meeting:${roomId}`).emit('meeting:screen-share', {
        userId,
        name: user.name,
        isSharing
      });
    });

    // Live captions / transcript
    socket.on('meeting:caption', ({ roomId, text, timestamp }) => {
      io.to(`meeting:${roomId}`).emit('meeting:caption', {
        userId,
        name: user.name,
        text,
        timestamp
      });
    });

    // Reaction
    socket.on('meeting:reaction', ({ roomId, emoji }) => {
      io.to(`meeting:${roomId}`).emit('meeting:reaction', {
        userId,
        name: user.name,
        emoji
      });
    });

    // Leave meeting
    socket.on('meeting:leave', ({ roomId }) => {
      socket.leave(`meeting:${roomId}`);
      if (meetingRooms.has(roomId)) {
        const room = meetingRooms.get(roomId);
        room.forEach(p => { if (p.userId === userId) room.delete(p); });
      }
      socket.to(`meeting:${roomId}`).emit('meeting:user-left', { userId, name: user.name });
    });

    // ─── NOTIFICATIONS ───────────────────────────────────

    socket.on('notification:send', async ({ targetUserId, type, title, message, link }) => {
      await createNotification(targetUserId, type, title, message, link);
      const targetSocket = onlineUsers.get(targetUserId);
      if (targetSocket) {
        io.to(targetSocket.socketId).emit('notification:new', { type, title, message, link });
      }
    });

    // ─── ACTIVITY LOGS ───────────────────────────────────

    socket.on('activity:log', ({ action, metadata }) => {
      // Broadcast to tenant admins
      socket.broadcast.emit('activity:new', {
        userId,
        userName: user.name,
        action,
        metadata,
        timestamp: new Date()
      });
    });

    // ─── DISCONNECT ──────────────────────────────────────

    socket.on('disconnect', async () => {
      console.log(`🔌 Socket disconnected: ${user.name}`);
      onlineUsers.delete(userId);

      // Clean up meeting rooms
      meetingRooms.forEach((participants, roomId) => {
        participants.forEach(p => {
          if (p.userId === userId) {
            participants.delete(p);
            io.to(`meeting:${roomId}`).emit('meeting:user-left', { userId, name: user.name });
          }
        });
      });

      // Clean up typing
      typingUsers.forEach((users, chatId) => {
        if (users.has(userId)) {
          users.delete(userId);
          socket.to(`chat:${chatId}`).emit('chat:typing', { userId, isTyping: false });
        }
      });

      await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date() });
      io.emit('users:online', Array.from(onlineUsers.entries()).map(([id, u]) => ({ id, ...u })));
    });
  });

  return io;
};

module.exports = initSocket;
