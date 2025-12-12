/**
 * Measurement Routes - Heart rate and blood oxygen measurements
 */

const express = require('express');
const router = express.Router();
const Measurement = require('../models/Measurement');
const Device = require('../models/Device');
const User = require('../models/User');
const { authenticate, authenticateDevice, requirePhysician } = require('../middleware/auth');
const { measurementRules, validate } = require('../middleware/validation');

/** POST /api/measurements - Record measurement from IoT device */
router.post('/', async (req, res, next) => {
  try {
    // Handle Particle Cloud webhook format
    if (req.body?.heart_rate !== undefined || req.body?.spo2 !== undefined) {
      const apiKey = req.body.api_key;
      if (!apiKey) {
        return res.status(401).json({ success: false, message: 'API key required (api_key field)' });
      }
      
      const device = await Device.findOne({ apiKey });
      if (!device) {
        return res.status(401).json({ success: false, message: 'Invalid API key' });
      }
      
      const { heart_rate: heartRate, spo2: bloodOxygen, timestamp: ts, valid = true } = req.body;
      
      if (heartRate === undefined || bloodOxygen === undefined) {
        return res.status(400).json({ success: false, message: 'Missing heart_rate or spo2' });
      }
      if (heartRate < 30 || heartRate > 250) {
        return res.status(400).json({ success: false, message: 'Heart rate must be 30-250 bpm' });
      }
      if (bloodOxygen < 70 || bloodOxygen > 100) {
        return res.status(400).json({ success: false, message: 'Blood oxygen must be 70-100%' });
      }
      
      if (valid) {
        const measurement = new Measurement({
          userId: device.owner, deviceId: device._id,
          heartRate: Math.round(heartRate), bloodOxygen: Math.round(bloodOxygen),
          timestamp: ts ? new Date(ts) : new Date(), wasOffline: false
        });
        await measurement.save();
        await Device.findByIdAndUpdate(device._id, { lastConnected: new Date() });
        
        return res.status(201).json({ success: true, message: 'Measurement recorded', measurement: { heartRate: Math.round(heartRate), bloodOxygen: Math.round(bloodOxygen), timestamp: measurement.timestamp } });
      }
      return res.json({ success: true, message: 'Invalid measurement not saved' });
    }
    next();
  } catch (error) {
    console.error('Measurement error:', error);
    res.status(500).json({ success: false, message: 'Error processing measurement', error: error.message });
  }
}, authenticateDevice, measurementRules(), validate, async (req, res) => {
  try {
    const { heartRate, bloodOxygen, timestamp, wasOffline } = req.body;
    const measurement = new Measurement({
      userId: req.device.owner, deviceId: req.deviceId,
      heartRate, bloodOxygen, timestamp: timestamp || new Date(), wasOffline: wasOffline || false
    });
    await measurement.save();
    await Device.findByIdAndUpdate(req.deviceId, { lastConnected: new Date() });
    res.status(201).json({ success: true, message: 'Measurement recorded', measurement });
  } catch (error) {
    console.error('Record measurement error:', error);
    res.status(500).json({ success: false, message: 'Error recording measurement', error: error.message });
  }
});

/** POST /api/measurements/batch - Record multiple measurements (offline sync) */
router.post('/batch', authenticateDevice, async (req, res) => {
  try {
    const { measurements } = req.body;
    if (!Array.isArray(measurements) || !measurements.length) {
      return res.status(400).json({ success: false, message: 'Measurements array required' });
    }

    const toInsert = measurements.map(m => ({ ...m, userId: req.device.owner, deviceId: req.deviceId, wasOffline: true }));
    const result = await Measurement.insertMany(toInsert);
    await Device.findByIdAndUpdate(req.deviceId, { lastConnected: new Date() });
    res.status(201).json({ success: true, message: `${result.length} measurements recorded`, count: result.length });
  } catch (error) {
    console.error('Batch record error:', error);
    res.status(500).json({ success: false, message: 'Error recording measurements', error: error.message });
  }
});

/** GET /api/measurements - Get user measurements */
router.get('/', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, deviceId, limit = 100 } = req.query;
    const query = { userId: req.userId };
    
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }
    if (deviceId) query.deviceId = deviceId;

    const measurements = await Measurement.find(query).sort({ timestamp: -1 }).limit(parseInt(limit)).populate('deviceId', 'deviceName');
    res.json({ success: true, count: measurements.length, measurements });
  } catch (error) {
    console.error('Get measurements error:', error);
    res.status(500).json({ success: false, message: 'Error fetching measurements', error: error.message });
  }
});

/** GET /api/measurements/summary/weekly - Weekly summary (last 7 days) */
router.get('/summary/weekly', authenticate, async (req, res) => {
  try {
    const sevenDaysAgo = new Date(); sevenDaysAgo.setHours(0,0,0,0); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const endDate = new Date(); endDate.setHours(23,59,59,999);

    const measurements = await Measurement.find({ userId: req.userId, timestamp: { $gte: sevenDaysAgo, $lte: endDate } }).sort({ timestamp: 1 });

    if (!measurements.length) {
      return res.json({ success: true, summary: { avgHeartRate: 0, minHeartRate: 0, maxHeartRate: 0, avgBloodOxygen: 0, minBloodOxygen: 0, maxBloodOxygen: 0, measurementCount: 0, dailyBreakdown: [], startDate: sevenDaysAgo, endDate } });
    }

    const hr = measurements.map(m => m.heartRate);
    const o2 = measurements.map(m => m.bloodOxygen);

    // Group by date
    const daily = {};
    measurements.forEach(m => {
      const key = m.timestamp.toISOString().split('T')[0];
      if (!daily[key]) daily[key] = { heartRates: [], bloodOxygenLevels: [], count: 0 };
      daily[key].heartRates.push(m.heartRate);
      daily[key].bloodOxygenLevels.push(m.bloodOxygen);
      daily[key].count++;
    });

    const dailyBreakdown = Object.keys(daily).sort().map(date => {
      const d = daily[date];
      return {
        date, measurementCount: d.count,
        avgHeartRate: Math.round(d.heartRates.reduce((a,b) => a+b, 0) / d.heartRates.length),
        minHeartRate: Math.min(...d.heartRates), maxHeartRate: Math.max(...d.heartRates),
        avgBloodOxygen: Math.round(d.bloodOxygenLevels.reduce((a,b) => a+b, 0) / d.bloodOxygenLevels.length),
        minBloodOxygen: Math.min(...d.bloodOxygenLevels), maxBloodOxygen: Math.max(...d.bloodOxygenLevels)
      };
    });

    res.json({ success: true, summary: {
      avgHeartRate: Math.round(hr.reduce((a,b) => a+b, 0) / hr.length), minHeartRate: Math.min(...hr), maxHeartRate: Math.max(...hr),
      avgBloodOxygen: Math.round(o2.reduce((a,b) => a+b, 0) / o2.length), minBloodOxygen: Math.min(...o2), maxBloodOxygen: Math.max(...o2),
      measurementCount: measurements.length, dailyBreakdown, startDate: sevenDaysAgo, endDate
    }});
  } catch (error) {
    console.error('Get weekly summary error:', error);
    res.status(500).json({ success: false, message: 'Error calculating weekly summary', error: error.message });
  }
});

/** GET /api/measurements/chart/weekly - Weekly chart data */
router.get('/chart/weekly', authenticate, async (req, res) => {
  try {
    const sevenDaysAgo = new Date(); sevenDaysAgo.setHours(0,0,0,0); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const endDate = new Date(); endDate.setHours(23,59,59,999);

    const measurements = await Measurement.find({ userId: req.userId, timestamp: { $gte: sevenDaysAgo, $lte: endDate } }).sort({ timestamp: 1 });

    const daily = {};
    measurements.forEach(m => {
      const key = m.timestamp.toISOString().split('T')[0];
      if (!daily[key]) daily[key] = { hr: [], o2: [] };
      daily[key].hr.push(m.heartRate);
      daily[key].o2.push(m.bloodOxygen);
    });

    const dates = [], heartRate = [], bloodOxygen = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      const key = d.toISOString().split('T')[0];
      dates.push(key);
      if (daily[key]) {
        heartRate.push(daily[key].hr.length ? Math.round(daily[key].hr.reduce((a,b) => a+b, 0) / daily[key].hr.length) : null);
        bloodOxygen.push(daily[key].o2.length ? Math.round(daily[key].o2.reduce((a,b) => a+b, 0) / daily[key].o2.length) : null);
      } else {
        heartRate.push(null); bloodOxygen.push(null);
      }
    }
    res.json({ success: true, chartData: { dates, heartRate, bloodOxygen } });
  } catch (error) {
    console.error('Get weekly chart error:', error);
    res.status(500).json({ success: false, message: 'Error fetching chart data', error: error.message });
  }
});

/** GET /api/measurements/summary/daily - Today's summary */
router.get('/summary/daily', authenticate, async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const measurements = await Measurement.find({ userId: req.userId, timestamp: { $gte: today, $lt: tomorrow } }).sort({ timestamp: 1 });

    if (!measurements.length) {
      return res.json({ success: true, summary: { avgHeartRate: 0, minHeartRate: 0, maxHeartRate: 0, avgBloodOxygen: 0, minBloodOxygen: 0, maxBloodOxygen: 0, measurementCount: 0, date: today.toISOString().split('T')[0] } });
    }

    const hr = measurements.map(m => m.heartRate);
    const o2 = measurements.map(m => m.bloodOxygen);
    res.json({ success: true, summary: {
      avgHeartRate: Math.round(hr.reduce((a,b) => a+b, 0) / hr.length), minHeartRate: Math.min(...hr), maxHeartRate: Math.max(...hr),
      avgBloodOxygen: Math.round(o2.reduce((a,b) => a+b, 0) / o2.length), minBloodOxygen: Math.min(...o2), maxBloodOxygen: Math.max(...o2),
      measurementCount: measurements.length, date: today.toISOString().split('T')[0]
    }});
  } catch (error) {
    console.error('Get daily summary error:', error);
    res.status(500).json({ success: false, message: 'Error calculating daily summary', error: error.message });
  }
});

/** GET /api/measurements/summary/monthly - Monthly summary (last 30 days) */
router.get('/summary/monthly', authenticate, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setHours(0,0,0,0); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const endDate = new Date(); endDate.setHours(23,59,59,999);

    const measurements = await Measurement.find({ userId: req.userId, timestamp: { $gte: thirtyDaysAgo, $lte: endDate } });

    if (!measurements.length) {
      return res.json({ success: true, summary: { avgHeartRate: 0, minHeartRate: 0, maxHeartRate: 0, avgBloodOxygen: 0, minBloodOxygen: 0, maxBloodOxygen: 0, measurementCount: 0, startDate: thirtyDaysAgo, endDate } });
    }

    const hr = measurements.map(m => m.heartRate);
    const o2 = measurements.map(m => m.bloodOxygen);
    res.json({ success: true, summary: {
      avgHeartRate: Math.round(hr.reduce((a,b) => a+b, 0) / hr.length), minHeartRate: Math.min(...hr), maxHeartRate: Math.max(...hr),
      avgBloodOxygen: Math.round(o2.reduce((a,b) => a+b, 0) / o2.length), minBloodOxygen: Math.min(...o2), maxBloodOxygen: Math.max(...o2),
      measurementCount: measurements.length, startDate: thirtyDaysAgo, endDate
    }});
  } catch (error) {
    console.error('Get monthly summary error:', error);
    res.status(500).json({ success: false, message: 'Error calculating monthly summary', error: error.message });
  }
});

/** GET /api/measurements/recent - Recent measurements */
router.get('/recent', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const measurements = await Measurement.find({ userId: req.userId }).sort({ timestamp: -1 }).limit(limit).populate('deviceId', 'deviceName deviceId');
    res.json({ success: true, count: measurements.length, measurements });
  } catch (error) {
    console.error('Get recent error:', error);
    res.status(500).json({ success: false, message: 'Error fetching recent measurements', error: error.message });
  }
});

/** GET /api/measurements/daily/:date - Measurements for specific date */
router.get('/daily/:date', authenticate, async (req, res) => {
  try {
    const targetDate = new Date(req.params.date);
    const nextDay = new Date(targetDate); nextDay.setDate(nextDay.getDate() + 1);

    const measurements = await Measurement.find({ userId: req.userId, timestamp: { $gte: targetDate, $lt: nextDay } }).sort({ timestamp: 1 }).populate('deviceId', 'deviceName');
    res.json({ success: true, date: req.params.date, count: measurements.length, measurements });
  } catch (error) {
    console.error('Get daily measurements error:', error);
    res.status(500).json({ success: false, message: 'Error fetching daily measurements', error: error.message });
  }
});

/** GET /api/measurements/patient/:patientId/summary - Patient summary for physician (ECE 513) */
router.get('/patient/:patientId/summary', authenticate, requirePhysician, async (req, res) => {
  try {
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const patient = await User.findOne({ _id: req.params.patientId, physician: req.userId });
    if (!patient) {
      return res.status(403).json({ success: false, message: 'Patient not found or not assigned to you' });
    }

    const measurements = await Measurement.find({ userId: req.params.patientId, timestamp: { $gte: sevenDaysAgo } });

    if (!measurements.length) {
      return res.json({ success: true, patient: patient.toJSON(), summary: { avgHeartRate: 0, minHeartRate: 0, maxHeartRate: 0, measurementCount: 0 } });
    }

    const hr = measurements.map(m => m.heartRate);
    res.json({ success: true, patient: patient.toJSON(), summary: {
      avgHeartRate: Math.round(hr.reduce((a,b) => a+b, 0) / hr.length), minHeartRate: Math.min(...hr), maxHeartRate: Math.max(...hr), measurementCount: measurements.length
    }});
  } catch (error) {
    console.error('Get patient summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching patient summary', error: error.message });
  }
});

module.exports = router;
