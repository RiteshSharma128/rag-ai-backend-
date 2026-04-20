const Meeting = require('../models/Meeting');
const { generateText } = require('../config/gemini');
const { v4: uuidv4 } = require('uuid');

// @POST /api/meetings
const createMeeting = async (req, res) => {
  try {
    const { title } = req.body;
    const roomId = uuidv4();

    const meeting = await Meeting.create({
      title: title || 'New Meeting',
      host: req.user._id,
      roomId,
      participants: [{ user: req.user._id, role: 'host', joinedAt: new Date() }],
      status: 'scheduled',
      tenant: req.user.tenant || null
    });

    res.status(201).json({
      success: true,
      meeting: {
        _id: meeting._id,
        roomId: meeting.roomId,
        title: meeting.title,
        status: meeting.status
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/meetings
const getMeetings = async (req, res) => {
  try {
    const meetings = await Meeting.find({
      $or: [
        { host: req.user._id },
        { 'participants.user': req.user._id }
      ]
    })
      .populate('host', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(30);

    res.json({ success: true, meetings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/meetings/:roomId
const getMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId })
      .populate('host', 'name avatar')
      .populate('participants.user', 'name avatar');

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    res.json({ success: true, meeting });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @POST /api/meetings/:roomId/join
const joinMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId });

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }
    if (meeting.status === 'ended') {
      return res.status(400).json({ success: false, message: 'Meeting has ended' });
    }

    const alreadyJoined = meeting.participants.some(
      p => p.user.toString() === req.user._id.toString()
    );

    if (!alreadyJoined) {
      meeting.participants.push({
        user: req.user._id,
        joinedAt: new Date(),
        role: 'participant'
      });
    }

    if (meeting.status === 'scheduled') {
      meeting.status = 'live';
      meeting.startTime = new Date();
    }

    await meeting.save();
    res.json({ success: true, meeting });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @POST /api/meetings/:roomId/end
const endMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findOne({
      roomId: req.params.roomId,
      host: req.user._id
    });

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found or not host' });
    }

    meeting.status = 'ended';
    meeting.endTime = new Date();
    meeting.duration = meeting.startTime
      ? Math.floor((new Date() - meeting.startTime) / 1000)
      : 0;

    // Update participant leave times
    meeting.participants.forEach(p => {
      if (!p.leftAt) p.leftAt = new Date();
    });

    await meeting.save();
    res.json({ success: true, meeting });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @POST /api/meetings/:id/transcript — add transcript entry
const addTranscript = async (req, res) => {
  try {
    const { speaker, text, timestamp } = req.body;
    
    const meeting = await Meeting.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          transcript: { speaker, text, timestamp, emotion: 'neutral' }
        }
      },
      { new: true }
    );

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    res.json({ success: true, message: 'Transcript added' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @POST /api/meetings/:id/analyze — AI analysis
const analyzeMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    if (meeting.host.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only host can analyze meeting' });
    }

    const transcriptText = meeting.transcript
      .map(t => `${t.speaker}: ${t.text}`)
      .join('\n');

    if (!transcriptText) {
      return res.status(400).json({ success: false, message: 'No transcript available' });
    }

    const prompt = `Analyze this meeting transcript and provide:
1. A concise summary (2-3 paragraphs)
2. Key action items (list format with assignees if mentioned)
3. Meeting highlights (top 5 important points)
4. Overall sentiment (positive/negative/neutral with brief explanation)
5. Meeting score out of 10 for: engagement, productivity

Transcript:
${transcriptText}

Respond in JSON format:
{
  "summary": "...",
  "actionItems": [{"task": "...", "assignee": "...", "dueDate": null}],
  "highlights": ["...", "..."],
  "sentiment": {"overall": "positive", "explanation": "..."},
  "scores": {"engagement": 8, "productivity": 7}
}`;

    const raw = await generateText(prompt);
    
    let analysis;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      analysis = {
        summary: raw,
        actionItems: [],
        highlights: [],
        sentiment: { overall: 'neutral', explanation: 'Unable to parse' },
        scores: { engagement: 5, productivity: 5 }
      };
    }

    meeting.summary = analysis.summary;
    meeting.actionItems = analysis.actionItems || [];
    meeting.highlights = analysis.highlights || [];
    meeting.sentiment = {
      overall: analysis.sentiment?.overall || 'neutral',
      score: analysis.sentiment?.score || 5
    };
    meeting.meetingScore = {
      engagement: analysis.scores?.engagement || 5,
      productivity: analysis.scores?.productivity || 5,
      overall: Math.round(((analysis.scores?.engagement || 5) + (analysis.scores?.productivity || 5)) / 2)
    };

    await meeting.save();

    res.json({
      success: true,
      analysis: {
        summary: meeting.summary,
        actionItems: meeting.actionItems,
        highlights: meeting.highlights,
        sentiment: meeting.sentiment,
        meetingScore: meeting.meetingScore
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/meetings/:id/summary
const getMeetingSummary = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id)
      .select('title summary actionItems highlights sentiment meetingScore duration startTime endTime');

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    res.json({ success: true, meeting });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createMeeting,
  getMeetings,
  getMeeting,
  joinMeeting,
  endMeeting,
  addTranscript,
  analyzeMeeting,
  getMeetingSummary
};
