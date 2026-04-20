const User = require('../models/User');
const { verifyAccessToken, verifyRefreshToken, generateAccessToken, setTokenCookies } = require('../utils/jwt');

// Protect route — must be logged in
const protect = async (req, res, next) => {
  try {
    let token;

    // 1. Check cookie first (preferred — httpOnly)
    if (req.cookies?.access_token) {
      token = req.cookies.access_token;
    }
    // 2. Fallback: Authorization header (for API clients)
    else if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please login.' });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (tokenError) {
      // Try refresh token auto-rotation
      const refreshToken = req.cookies?.refresh_token;
      if (!refreshToken) {
        return res.status(401).json({ success: false, message: 'Session expired. Please login.' });
      }

      try {
        const refreshDecoded = verifyRefreshToken(refreshToken);
        const user = await User.findById(refreshDecoded.id).select('+refreshToken');
        
        if (!user || user.refreshToken !== refreshToken) {
          return res.status(401).json({ success: false, message: 'Invalid session. Please login.' });
        }

        // Auto-rotate: issue new access token
        const newAccessToken = generateAccessToken(user._id);
        res.cookie('access_token', newAccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000,
          path: '/'
        });
        
        decoded = { id: user._id };
      } catch {
        return res.status(401).json({ success: false, message: 'Session expired. Please login.' });
      }
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Authentication failed.' });
  }
};

// Admin only
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
};

// Role-based
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user?.role}' is not authorized for this action.`
      });
    }
    next();
  };
};

// Optional auth - doesn't block if not logged in
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.access_token || 
      req.headers.authorization?.split(' ')[1];
    
    if (token) {
      const decoded = verifyAccessToken(token);
      req.user = await User.findById(decoded.id);
    }
  } catch { /* silent — user is just null */ }
  next();
};

module.exports = { protect, adminOnly, authorize, optionalAuth };
