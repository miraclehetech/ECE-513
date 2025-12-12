/**
 * Device Routes - Device registration and management
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Device = require('../models/Device');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const { deviceRegistrationRules, validate } = require('../middleware/validation');

/** POST /api/devices/register - Register new device */
router.post('/register', authenticate, deviceRegistrationRules(), validate, async (req, res) => {
  try {
    const { deviceId, deviceName, firmwareVersion, isActive } = req.body;

    if (await Device.findOne({ deviceId })) {
      return res.status(400).json({ success: false, message: 'Device with this ID is already registered' });
    }

    const apiKey = crypto.randomBytes(32).toString('hex');
    const deviceData = {
      deviceId, deviceName, owner: req.userId, apiKey, lastConnected: new Date(),
      ...(firmwareVersion && { firmwareVersion }),
      ...(typeof isActive !== 'undefined' && { isActive: isActive === true || isActive === 'true' })
    };

    const device = new Device(deviceData);
    await device.save();
    await User.findByIdAndUpdate(req.userId, { $push: { devices: device._id } });

    res.status(201).json({
      success: true, message: 'Device registered successfully',
      device: { _id: device._id, deviceId: device.deviceId, deviceName: device.deviceName, apiKey: device.apiKey, isActive: device.isActive, createdAt: device.createdAt }
    });
  } catch (error) {
    console.error('Device registration error:', error);
    res.status(500).json({ success: false, message: 'Error registering device', error: error.message });
  }
});

/** GET /api/devices - Get all user devices */
router.get('/', authenticate, async (req, res) => {
  try {
    const devices = await Device.find({ owner: req.userId }).select('-apiKey');
    res.json({ success: true, devices });
  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({ success: false, message: 'Error fetching devices', error: error.message });
  }
});

/** GET /api/devices/:id - Get device details */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const device = await Device.findOne({ _id: req.params.id, owner: req.userId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    res.json({ success: true, device });
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({ success: false, message: 'Error fetching device', error: error.message });
  }
});

/** PUT /api/devices/:id - Update device */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const updates = { updatedAt: new Date() };
    if (req.body.deviceName) updates.deviceName = req.body.deviceName;
    if (req.body.firmwareVersion) updates.firmwareVersion = req.body.firmwareVersion;
    if (typeof req.body.isActive !== 'undefined') updates.isActive = req.body.isActive;

    const device = await Device.findOneAndUpdate(
      { _id: req.params.id, owner: req.userId },
      { $set: updates },
      { new: true }
    );
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    res.json({ success: true, message: 'Device updated successfully', device });
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({ success: false, message: 'Error updating device', error: error.message });
  }
});

/** DELETE /api/devices/:id - Remove device */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const device = await Device.findOneAndDelete({ _id: req.params.id, owner: req.userId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    await User.findByIdAndUpdate(req.userId, { $pull: { devices: device._id } });
    res.json({ success: true, message: 'Device removed successfully' });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ success: false, message: 'Error removing device', error: error.message });
  }
});

/** POST /api/devices/:id/preferences - Get user preferences for device */
router.post('/:id/preferences', async (req, res) => {
  try {
    const apiKey = req.body.api_key;
    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'API key required in body (api_key field)' });
    }
    
    const device = await Device.findOne({ _id: req.params.id, apiKey }).populate('owner', 'measurementPreferences');
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found or invalid API key' });
    }

    device.lastConnected = new Date();
    await device.save();
    res.json({ success: true, preferences: device.owner.measurementPreferences });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ success: false, message: 'Error fetching preferences', error: error.message });
  }
});

module.exports = router;
