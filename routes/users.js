/**
 * User Routes - Profile management
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Physician = require('../models/Physician');
const { authenticate } = require('../middleware/auth');

/** GET /api/users/me - Get current user profile */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .populate('devices')
      .populate('physician', 'fullName email specialty');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user: user.toJSON() });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Error fetching user profile', error: error.message });
  }
});

/** PUT /api/users/me - Update current user profile */
router.put('/me', authenticate, async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.email;
    delete updates.password;
    delete updates._id;

    const user = await User.findByIdAndUpdate(req.userId, { $set: updates }, { new: true, runValidators: true }).populate('devices');
    res.json({ success: true, message: 'User profile updated successfully', user: user.toJSON() });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: 'Error updating user profile', error: error.message });
  }
});

/** PUT /api/users/me/preferences - Update measurement preferences */
router.put('/me/preferences', authenticate, async (req, res) => {
  try {
    const { startTime, endTime, frequency } = req.body;
    const preferences = {};
    if (startTime) preferences['measurementPreferences.startTime'] = startTime;
    if (endTime) preferences['measurementPreferences.endTime'] = endTime;
    if (frequency) preferences['measurementPreferences.frequency'] = frequency;

    const user = await User.findByIdAndUpdate(req.userId, { $set: preferences }, { new: true });
    res.json({ success: true, message: 'Preferences updated successfully', preferences: user.measurementPreferences });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ success: false, message: 'Error updating preferences', error: error.message });
  }
});

/** GET /api/users/physicians - List all physicians */
router.get('/physicians', authenticate, async (req, res) => {
  try {
    const physicians = await Physician.find().select('fullName email specialty licenseNumber');
    res.json({ success: true, physicians });
  } catch (error) {
    console.error('Get physicians error:', error);
    res.status(500).json({ success: false, message: 'Error fetching physicians', error: error.message });
  }
});

/** PUT /api/users/me/physician - Assign physician to user */
router.put('/me/physician', authenticate, async (req, res) => {
  try {
    const { physicianId } = req.body;
    if (!physicianId) {
      return res.status(400).json({ success: false, message: 'Physician ID is required' });
    }

    const physician = await Physician.findById(physicianId);
    if (!physician) {
      return res.status(404).json({ success: false, message: 'Physician not found' });
    }

    const user = await User.findByIdAndUpdate(req.userId, { physician: physicianId }, { new: true })
      .populate('physician', 'fullName email specialty');
    res.json({ success: true, message: 'Physician assigned successfully', physician: user.physician });
  } catch (error) {
    console.error('Assign physician error:', error);
    res.status(500).json({ success: false, message: 'Error assigning physician', error: error.message });
  }
});

/** GET /api/users/physician/patients - Get physician's patients (ECE 513) */
router.get('/physician/patients', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'physician') {
      return res.status(403).json({ success: false, message: 'Access denied. Physician account required.' });
    }

    const patients = await User.find({ physician: req.userId })
      .select('fullName email phone dateOfBirth createdAt')
      .populate('devices', 'deviceName isActive lastSeen');
    res.json({ success: true, patients });
  } catch (error) {
    console.error('Get physician patients error:', error);
    res.status(500).json({ success: false, message: 'Error fetching patients', error: error.message });
  }
});

/** GET /api/users/physician/me - Get physician profile (ECE 513) */
router.get('/physician/me', authenticate, async (req, res) => {
  try {
    if (req.userType !== 'physician') {
      return res.status(403).json({ success: false, message: 'Access denied. Physician account required.' });
    }

    const physician = await Physician.findById(req.userId);
    if (!physician) {
      return res.status(404).json({ success: false, message: 'Physician not found' });
    }

    const patientCount = await User.countDocuments({ physician: req.userId });
    res.json({ success: true, physician: physician.toJSON(), patientCount });
  } catch (error) {
    console.error('Get physician profile error:', error);
    res.status(500).json({ success: false, message: 'Error fetching physician profile', error: error.message });
  }
});

module.exports = router;
