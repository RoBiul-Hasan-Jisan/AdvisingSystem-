// Run once, right after `npm run seed`, to create the very first admin
// account - every /api/admin/* route requires an admin-role token to call,
// and there is no admin yet on a fresh install, so this is the one place
// that talks to Firebase Auth directly instead of going through the API.
//
// Usage: node src/seed/bootstrapAdmin.js "Admin Name" admin@example.com "TempPass123!"
require('dotenv').config();
const mongoose = require('mongoose');
const admin = require('firebase-admin');
const connectDB = require('../config/db');
const initFirebase = require('../config/firebase');
const User = require('../models/User');

async function bootstrap() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Usage: node src/seed/bootstrapAdmin.js "Name" email password');
    process.exit(1);
  }

  const fb = initFirebase();
  await connectDB();

  // Reuse the Firebase user if one with this email already exists (e.g. you
  // ran this before and just want to (re)link the Mongo side), otherwise
  // create a fresh one.
  let firebaseUser;
  try {
    firebaseUser = await fb.auth().getUserByEmail(email);
    console.log(`[bootstrap] Firebase account already exists for ${email}, reusing it.`);
  } catch {
    firebaseUser = await fb.auth().createUser({ email, password, displayName: name });
    console.log(`[bootstrap] created Firebase account for ${email}.`);
  }

  const user = await User.findOneAndUpdate(
    { firebaseUid: firebaseUser.uid },
    { firebaseUid: firebaseUser.uid, name, email, role: 'admin' },
    { upsert: true, new: true }
  );

  console.log(`[bootstrap] admin ready: ${user.email} (role: ${user.role})`);
  await mongoose.disconnect();
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error('[bootstrap] failed:', err.message);
  process.exit(1);
});
