require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const admin = require('firebase-admin');
const { rateLimit } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { securityHeaders } = require('./middleware/security');

// --- Fail fast if required config is missing ---
// Catches a broken deploy at startup with a clear message, instead of the
// server booting "successfully" and then every request mysteriously 500ing.
const REQUIRED_ENV = ['MONGO_URI', 'FIREBASE_SERVICE_ACCOUNT_PATH'];
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill these in before starting the server.');
  process.exit(1);
}

// --- Firebase Admin init ---
admin.initializeApp({
  credential: admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH))
});

const app = express();
app.disable('x-powered-by'); // don't advertise "Express" to every client

// CORS: restrict to your actual frontend origin in production. Falls back to
// the Next.js dev server default so local development works out of the box,
// but set FRONTEND_URL explicitly once this is deployed anywhere real.
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(securityHeaders);
app.use(express.json());

// General ceiling on the whole API, keyed by IP - generous enough not to
// bother a real user clicking around, tight enough to blunt a runaway script.
app.use('/api', rateLimit({ windowMs: 60_000, max: 120 }));

// Tighter limits on the two heaviest/most sensitive endpoints: PDF parsing
// (CPU + file upload) and account provisioning (creates real Firebase logins).
const heavyLimiter = rateLimit({ windowMs: 60_000, max: 10 });
app.use('/api/structure/import', heavyLimiter);
app.use('/api/promotion/bulk-csv', heavyLimiter);
app.use('/api/users', rateLimit({ windowMs: 60_000, max: 20 }));

app.use('/api/structure', require('./routes/structure'));
app.use('/api/audit-log', require('./routes/auditLog'));
app.use('/api/users', require('./routes/users'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/sections', require('./routes/sections'));
app.use('/api/enrollment', require('./routes/enrollment'));
app.use('/api/promotion', require('./routes/promotion'));
app.use('/api/notifications', require('./routes/notifications'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Must be registered after every route: 404 for anything unmatched, then
// the central error handler for anything a route passed to next(err) -
// which is every async route now that they're wrapped in asyncHandler.
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => console.error('MongoDB connection error:', err));
