/**
 * Authentication Middleware
 * Handles JWT token verification and authorization
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Physician = require('../models/Physician');

/**
 * Authenticate user via JWT token
 * Adds user, userId, userType to request object
 */
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token provided'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    
    if (!decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format'
      });
    }
    
    const user = decoded.type === 'physician' 
      ? await Physician.findById(decoded.id)
      : await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Please login again.'
      });
    }

    req.user = user;
    req.userId = user._id;
    req.userType = decoded.type || 'user';
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

/**
 * Authenticate IoT device via API key
 * Expects api_key in request body
 * Adds device, deviceId to request object
 */
const authenticateDevice = async (req, res, next) => {
  try {
    const apiKey = req.body.api_key;
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: 'No API key provided in body (api_key field required)'
      });
    }

    const Device = require('../models/Device');
    const device = await Device.findOne({ apiKey });
    
    if (!device) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API key'
      });
    }

    req.device = device;
    req.deviceId = device._id;
    next();
  } catch (error) {
    console.error('Device authentication error:', error);
    return res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

/**
 * Require physician role
 * Must be used after authenticate middleware
 */
const requirePhysician = (req, res, next) => {
  if (req.userType !== 'physician') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Physician account required.'
    });
  }
  next();
};

module.exports = {
  authenticate,
  authenticateDevice,
  requirePhysician
};
