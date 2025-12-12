/**
 * Validation Middleware
 * Request data validation using express-validator
 */

const { body, validationResult } = require('express-validator');

/**
 * Validate password strength
 * Requires: min 8 chars, uppercase, lowercase, number, special char
 */
const validatePassword = (password) => {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^a-zA-Z0-9]/.test(password)  // Any non-alphanumeric character counts as special
  );
};

/**
 * Validation rules for user registration
 */
const userRegistrationRules = () => [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .custom((value) => {
      if (!validatePassword(value)) {
        throw new Error('Password must be at least 8 characters with uppercase, lowercase, number, and special character');
      }
      return true;
    }),
  body('fullName')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Full name must be at least 2 characters long')
];

/**
 * Validation rules for device registration
 */
const deviceRegistrationRules = () => [
  body('deviceId')
    .trim()
    .isLength({ min: 1 })
    .withMessage('Device ID is required'),
  body('deviceName')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Device name must be at least 2 characters long'),
  body('firmwareVersion')
    .optional()
    .trim()
    .matches(/^\d+\.\d+\.\d+$/)
    .withMessage('Firmware version must be in format X.Y.Z'),
  body('isActive')
    .optional()
    .custom((value) => {
      if (value === undefined || value === null || typeof value === 'boolean' || value === 'true' || value === 'false') {
        return true;
      }
      throw new Error('isActive must be a boolean value');
    })
];

/**
 * Validation rules for measurement data
 */
const measurementRules = () => [
  body('heartRate')
    .isFloat({ min: 30, max: 250 })
    .withMessage('Heart rate must be between 30 and 250 bpm'),
  body('bloodOxygen')
    .isFloat({ min: 70, max: 100 })
    .withMessage('Blood oxygen must be between 70 and 100 percent')
];

/**
 * Check validation results and return errors if any
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

module.exports = {
  validatePassword,
  userRegistrationRules,
  deviceRegistrationRules,
  measurementRules,
  validate
};
