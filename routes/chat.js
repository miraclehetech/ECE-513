/**
 * Chat Routes - LLM health assistant (ECE 513)
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Measurement = require('../models/Measurement');
const User = require('../models/User');
const Device = require('../models/Device');

/** POST /api/chat - Send message to LLM health assistant */
router.post('/', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const LLM_API_KEY = process.env.LLM_API_KEY;
    const LLM_API_URL = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
    const LLM_MODEL = process.env.LLM_MODEL || 'gpt-3.5-turbo';

    if (!LLM_API_KEY) {
      return res.status(503).json({ success: false, message: 'LLM service is not configured.' });
    }

    // Get user data for RAG context
    const user = await User.findById(req.userId);
    const devices = await Device.find({ userId: req.userId });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const measurements = await Measurement.find({ userId: req.userId, timestamp: { $gte: sevenDaysAgo } })
      .sort({ timestamp: -1 }).limit(100);

    // Calculate health stats
    const healthStats = { totalMeasurements: measurements.length, avgHeartRate: 0, minHeartRate: 0, maxHeartRate: 0, avgBloodOxygen: 0, minBloodOxygen: 0, maxBloodOxygen: 0, recentReadings: [] };

    if (measurements.length > 0) {
      const hr = measurements.map(m => m.heartRate);
      const o2 = measurements.map(m => m.bloodOxygen);
      healthStats.avgHeartRate = Math.round(hr.reduce((a, b) => a + b, 0) / hr.length);
      healthStats.minHeartRate = Math.min(...hr);
      healthStats.maxHeartRate = Math.max(...hr);
      healthStats.avgBloodOxygen = Math.round(o2.reduce((a, b) => a + b, 0) / o2.length);
      healthStats.minBloodOxygen = Math.min(...o2);
      healthStats.maxBloodOxygen = Math.max(...o2);
      healthStats.recentReadings = measurements.slice(0, 10).map(m => ({ timestamp: m.timestamp.toISOString(), heartRate: m.heartRate, bloodOxygen: m.bloodOxygen }));
    }

    const systemPrompt = buildSystemPrompt(user, devices, healthStats);

    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }], temperature: 0.7, max_tokens: 1000 })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('LLM API error:', response.status, errorData);
      return res.status(500).json({ success: false, message: 'Error communicating with LLM service' });
    }

    const llmResponse = await response.json();
    res.json({ success: true, response: llmResponse.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.', context: { totalMeasurements: healthStats.totalMeasurements, dateRange: '7 days' } });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, message: 'Error processing chat request', error: error.message });
  }
});

/** GET /api/chat/context - Get user's health context */
router.get('/context', authenticate, async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const measurements = await Measurement.find({ userId: req.userId, timestamp: { $gte: sevenDaysAgo } }).sort({ timestamp: -1 });
    const summary = { totalMeasurements: measurements.length, avgHeartRate: 0, avgBloodOxygen: 0, dateRange: `${sevenDaysAgo.toLocaleDateString()} - ${new Date().toLocaleDateString()}` };

    if (measurements.length > 0) {
      summary.avgHeartRate = Math.round(measurements.reduce((sum, m) => sum + m.heartRate, 0) / measurements.length);
      summary.avgBloodOxygen = Math.round(measurements.reduce((sum, m) => sum + m.bloodOxygen, 0) / measurements.length);
    }
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Get context error:', error);
    res.status(500).json({ success: false, message: 'Error fetching context' });
  }
});

/** Build system prompt with user health data (RAG) */
function buildSystemPrompt(user, devices, stats) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return `You are a helpful health assistant for Heart Track. Today is ${date}.
You are helping "${user.fullName || 'User'}" understand their heart health data.

## Health Data (Last 7 Days):
- Measurements: ${stats.totalMeasurements}
- Avg Heart Rate: ${stats.avgHeartRate} bpm (Range: ${stats.minHeartRate}-${stats.maxHeartRate})
- Avg SpO2: ${stats.avgBloodOxygen}% (Range: ${stats.minBloodOxygen}%-${stats.maxBloodOxygen}%)

## Devices: ${devices.length}
${devices.map(d => `- ${d.deviceName} (${d.isActive ? 'Active' : 'Inactive'})`).join('\n')}

## Recent Readings:
${stats.recentReadings.length > 0 ? stats.recentReadings.map(r => `- ${new Date(r.timestamp).toLocaleString()}: HR ${r.heartRate}, SpO2 ${r.bloodOxygen}%`).join('\n') : '- No data'}

## Guidelines:
- Normal resting HR: 60-100 bpm, SpO2: 95-100%
- Suggest consulting a doctor if HR < 50 or > 120, SpO2 < 92%
- You are NOT a doctor. Recommend professional advice for concerns.
- Be friendly and supportive. Redirect off-topic questions.`;
}

module.exports = router;
