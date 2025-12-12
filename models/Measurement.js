/**
 * Measurement Model
 * Schema for heart rate and blood oxygen measurements
 */

const mongoose = require('mongoose');

const measurementSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  deviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: true,
    index: true
  },
  heartRate: {
    type: Number,
    required: true,
    min: 30,
    max: 250
  },
  bloodOxygen: {
    type: Number,
    required: true,
    min: 70,
    max: 100
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  wasOffline: { type: Boolean, default: false },
  recordedAt: { type: Date, default: Date.now }
});

// Compound indexes for efficient querying
measurementSchema.index({ userId: 1, timestamp: -1 });
measurementSchema.index({ deviceId: 1, timestamp: -1 });

module.exports = mongoose.model('Measurement', measurementSchema);
