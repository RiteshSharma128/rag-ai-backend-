


const Chat = require('../models/Chat');
const Document = require('../models/Document');
const { generateRAGAnswer } = require('../services/ragService');
const { generateText, generateStreamingText } = require('../config/gemini');
const { cacheGet, cacheSet, cacheDel } = require('../config/redis');

// @POST /api/chats
const createChat = async (req, res) => {
  try {
    const { documentId, title } = req.body;
    let document = null;

    if (documentId) {
      document = await Document.findOne({ _id: documentId, user: req.user._id });
      if (!document) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
    }

    const chat = await Chat.create({
      title: title || (document ? `Chat: ${document.name}` : 'New Chat'),
      user: req.user._id,
      document: documentId || null,
      messages: []
    });

    await cacheDel(`chats:${req.user._id}`);
    res.status(201).json({ success: true, chat });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/chats
const getChats = async (req, res) => {
  try {
    const cacheKey = `chats:${req.user._id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ success: true, chats: cached });

    const chats = await Chat.find({ user: req.user._id, isArchived: false })
      .populate('document', 'name fileType')
      .select('-messages')
      .sort({ lastMessageAt: -1 })
      .limit(50);

    await cacheSet(cacheKey, chats, 30);
    res.json({ success: true, chats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/chats/:id
const getChat = async (req, res) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, user: req.user._id })
      .populate('document', 'name fileType totalPages');

    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    res.json({ success: true, chat });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @POST /api/chats/:id/message — non-streaming
const sendMessage = async (req, res) => {
  try {
    const { content } = req.body;
    const chat = await Chat.findOne({ _id: req.params.id, user: req.user._id })
      .populate('document');

    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    chat.messages.push({ role: 'user', content });

    let aiResponse = '';
    let sources = [];

    // Load fresh document to get vectorCollectionId
    if (chat.document) {
      const freshDoc = await Document.findById(chat.document._id);
      if (freshDoc?.vectorCollectionId) {
        chat.document.vectorCollectionId = freshDoc.vectorCollectionId;
      }
    }

    if (chat.document?.vectorCollectionId) {
      const { prompt, relevantChunks } = await generateRAGAnswer(
        content,
        chat.document.vectorCollectionId,
        chat.messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      );
      aiResponse = await generateText(prompt);
      sources = relevantChunks.map(c => ({
        documentId: chat.document._id,
        fileName: chat.document.name,
        excerpt: c.text.substring(0, 200),
        similarity: c.similarity
      }));
    } else {
      const history = chat.messages.slice(-10).map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      ).join('\n');
      aiResponse = await generateText(
        `You are a helpful AI assistant.\n\n${history}\n\nUser: ${content}\n\nAssistant:`
      );
    }

    chat.messages.push({
      role: 'assistant',
      content: aiResponse,
      sources,
      metadata: { model: 'gemini-1.5-flash' }
    });

    if (chat.messages.length === 2 && chat.title === 'New Chat') {
      chat.title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
    }

    chat.lastMessageAt = new Date();
    await chat.save();
    await cacheDel(`chats:${req.user._id}`);

    res.json({
      success: true,
      message: chat.messages[chat.messages.length - 1],
      sources
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @POST /api/chats/:id/message/stream — SSE streaming
const sendMessageStream = async (req, res) => {
  try {
    const { content } = req.body;
    const chat = await Chat.findOne({ _id: req.params.id, user: req.user._id })
      .populate('document');

    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.flushHeaders();

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    chat.messages.push({ role: 'user', content });

    let prompt = '';
    let sources = [];

    // Load fresh document to get vectorCollectionId
    if (chat.document) {
      const freshDoc = await Document.findById(chat.document._id);
      console.log("VECTOR ID:", freshDoc?.vectorCollectionId);
      if (freshDoc?.vectorCollectionId) {
        chat.document.vectorCollectionId = freshDoc.vectorCollectionId;
      }
    }

    if (chat.document?.vectorCollectionId) {
      const ragResult = await generateRAGAnswer(
        content,
        chat.document.vectorCollectionId,
        chat.messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      );
      prompt = ragResult.prompt;
      sources = ragResult.relevantChunks.map(c => ({
        documentId: chat.document._id,
        fileName: chat.document.name,
        excerpt: c.text.substring(0, 200),
        similarity: c.similarity
      }));
      sendEvent({ type: 'sources', sources });
    } else {
      const history = chat.messages.slice(-10).map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      ).join('\n');
      prompt = `You are a helpful AI assistant.\n\n${history}\n\nUser: ${content}\n\nAssistant:`;
    }

    let fullResponse = '';

    try {
      await generateStreamingText(prompt, (chunk) => {
        if (chunk) {
          fullResponse += chunk;
          sendEvent({ type: 'chunk', content: chunk });
        }
      });
    } catch (streamErr) {
      fullResponse = await generateText(prompt);
      sendEvent({ type: 'chunk', content: fullResponse });
    }

    if (!fullResponse) {
      fullResponse = 'Sorry, I could not generate a response. Please try again.';
      sendEvent({ type: 'chunk', content: fullResponse });
    }

    chat.messages.push({
      role: 'assistant',
      content: fullResponse,
      sources,
      metadata: { model: 'gemini-1.5-flash' }
    });

    if (chat.messages.length === 2 && chat.title === 'New Chat') {
      chat.title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
    }

    chat.lastMessageAt = new Date();
    await chat.save();
    await cacheDel(`chats:${req.user._id}`);

    sendEvent({ type: 'done', chatId: chat._id, title: chat.title });
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
};

// @DELETE /api/chats/:id
const deleteChat = async (req, res) => {
  try {
    const chat = await Chat.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    await cacheDel(`chats:${req.user._id}`);
    res.json({ success: true, message: 'Chat deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @PUT /api/chats/:id/archive
const archiveChat = async (req, res) => {
  try {
    const chat = await Chat.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isArchived: true },
      { new: true }
    );
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });
    await cacheDel(`chats:${req.user._id}`);
    res.json({ success: true, message: 'Chat archived' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @PUT /api/chats/:id/title
const updateChatTitle = async (req, res) => {
  try {
    const { title } = req.body;
    const chat = await Chat.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { title },
      { new: true }
    );
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });
    await cacheDel(`chats:${req.user._id}`);
    res.json({ success: true, chat });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createChat,
  getChats,
  getChat,
  sendMessage,
  sendMessageStream,
  deleteChat,
  archiveChat,
  updateChatTitle
};
