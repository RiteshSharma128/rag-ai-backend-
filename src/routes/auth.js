const express = require('express');
const router = express.Router();
const {
  register, login, logout, refreshToken, getMe, updateProfile, changePassword
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { uploadAvatar } = require('../middleware/upload');

router.post('/register', validate(schemas.register), register);
router.post('/login', validate(schemas.login), login);
router.post('/logout', protect, logout);
router.post('/refresh', refreshToken);
router.get('/me', protect, getMe);
router.put('/update-profile', protect, uploadAvatar.single('avatar'), updateProfile);
router.put('/change-password', protect, validate(schemas.changePassword), changePassword);

module.exports = router;
