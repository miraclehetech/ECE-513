/**
 * Heart Track - Main Server
 * ECE 413/513 Final Project
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hearttrack', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✓ Connected to MongoDB'))
.catch(err => { console.error('✗ MongoDB error:', err); process.exit(1); });

// API Routes
app.get('/api', (req, res) => res.json({ message: 'Heart Track API', version: '1.0.0' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/devices', require('./routes/devices'));
app.use('/api/measurements', require('./routes/measurements'));
app.use('/api/chat', require('./routes/chat'));

// Serve frontend
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Error handlers
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});
app.use((req, res) => res.status(404).json({ success: false, message: 'Endpoint not found' }));

// SSL Configuration
const SSL_KEY = process.env.SSL_KEY_PATH || path.join(__dirname, 'certs', 'server.key');
const SSL_CERT = process.env.SSL_CERT_PATH || path.join(__dirname, 'certs', 'server.crt');

let httpsOptions = null;
if (fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT)) {
  httpsOptions = { key: fs.readFileSync(SSL_KEY), cert: fs.readFileSync(SSL_CERT) };
  console.log('✓ SSL certificates loaded');
}

// Start server
if (httpsOptions) {
  https.createServer(httpsOptions, app).listen(PORT, () => {
    console.log(`✓ HTTPS server running on port ${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`✓ HTTP server running on port ${PORT}`);
    console.log('⚠ No SSL certificates - running in HTTP mode');
  });
}

module.exports = app;
