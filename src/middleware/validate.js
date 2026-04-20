const Joi = require('joi');

const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      const errors = error.details.map(d => d.message.replace(/['"]/g, ''));
      return res.status(400).json({ success: false, message: errors[0], errors });
    }
    next();
  };
};

// Auth schemas
const registerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required()
    .messages({ 'any.only': 'Passwords do not match' })
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
    .messages({ 'any.only': 'Passwords do not match' })
});

// Chat schemas
const createChatSchema = Joi.object({
  documentId: Joi.string().optional(),
  title: Joi.string().max(100).optional()
});

const sendMessageSchema = Joi.object({
  content: Joi.string().min(1).max(10000).required(),
  chatId: Joi.string().required()
});

module.exports = {
  validate,
  schemas: {
    register: registerSchema,
    login: loginSchema,
    changePassword: changePasswordSchema,
    createChat: createChatSchema,
    sendMessage: sendMessageSchema
  }
};
