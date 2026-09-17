const initFirebase = require('../config/firebase');
const User = require('../models/User');

/**
 * Expects: Authorization: Bearer <Firebase ID token>
 * Verifies the token with Firebase Admin, then loads (or 404s) the matching
 * Mongo user by firebaseUid. Downstream routes read req.dbUser.
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });

    const admin = initFirebase();
    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUser = decoded;

    const dbUser = await User.findOne({ firebaseUid: decoded.uid });
    if (!dbUser) {
      return res.status(404).json({ error: 'No account provisioned for this login. Contact admin.' });
    }
    req.dbUser = dbUser;
    next();
  } catch (err) {
    console.error('[auth] token verification failed', err.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.dbUser || !roles.includes(req.dbUser.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
