/**
 * Auth Routes - User/Physician registration and login
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Physician = require('../models/Physician');
const { userRegistrationRules, validate } = require('../middleware/validation');

/** POST /api/auth/register - Register new user */
router.post('/register', userRegistrationRules(), validate, async (req, res) => {
  try {
    const { email, password, fullName, phone, dateOfBirth } = req.body;

    if (await User.findOne({ email })) {
      return res.status(400).json({ success: false, message: 'User with this email already exists' });
    }

    const user = new User({ email, password, fullName, phone, dateOfBirth });
    await user.save();

    const token = jwt.sign(
      { id: user._id, email: user.email, type: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ success: true, message: 'User registered successfully', token, user: user.toJSON() });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Error registering user', error: error.message });
  }
});

/** POST /api/auth/login - Login with email/password */
router.post('/login', async (req, res) => {
  try {
    const { email, password, userType = 'user' } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const account = userType === 'physician' 
      ? await Physician.findOne({ email }) 
      : await User.findOne({ email });

    if (!account || !(await account.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: account._id, email: account.email, type: userType },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, message: 'Login successful', token, [userType]: account.toJSON() });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Error logging in', error: error.message });
  }
});

/** POST /api/auth/physician/register - Register new physician (ECE 513) */
router.post('/physician/register', userRegistrationRules(), validate, async (req, res) => {
  try {
    const { email, password, fullName, licenseNumber, specialty, phone } = req.body;

    if (await Physician.findOne({ $or: [{ email }, { licenseNumber }] })) {
      return res.status(400).json({ success: false, message: 'Physician with this email or license already exists' });
    }

    const physician = new Physician({ email, password, fullName, licenseNumber, specialty, phone });
    await physician.save();

    const token = jwt.sign(
      { id: physician._id, email: physician.email, type: 'physician' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ success: true, message: 'Physician registered successfully', token, physician: physician.toJSON() });
  } catch (error) {
    console.error('Physician registration error:', error);
    res.status(500).json({ success: false, message: 'Error registering physician', error: error.message });
  }
});

module.exports = router;
