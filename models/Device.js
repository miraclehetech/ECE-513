/**
 * Device Model
 * Schema for IoT devices (Raspberry Pi)
 */

const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  deviceName: {
    type: String,
    required: true,
    trim: true
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  apiKey: {
    type: String,
    required: true,
    unique: true
  },
  isActive: { type: Boolean, default: true },
  lastConnected: Date,
  firmwareVersion: { type: String, default: '1.0.0' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

/** Update timestamp on update */
deviceSchema.pre('findOneAndUpdate', function(next) {
  this.set({ updatedAt: Date.now() });
  next();
});

module.exports = mongoose.model('Device', deviceSchema);
