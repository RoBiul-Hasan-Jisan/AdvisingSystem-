// Run once to create the very first admin account, since /api/users requires
// an admin token to hit and there isn't one yet on a fresh install.
// Usage: node seed/bootstrapAdmin.js "Admin Name" admin@example.com "TempPass123!"
require('dotenv').config();
const mongoose = require('mongoose');
const admin = require('firebase-admin');
const User = require('../models/User');

async function bootstrap() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Usage: node seed/bootstrapAdmin.js "Name" email password');
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH))
  });
  await mongoose.connect(process.env.MONGO_URI);

  const firebaseUser = await admin.auth().createUser({ email, password, displayName: name });
  const user = await User.create({
    firebaseUid: firebaseUser.uid,
    name,
    email,
    role: 'admin'
  });

  console.log('Admin created:', user.email);
  await mongoose.disconnect();
  process.exit(0);
}

bootstrap().catch(err => { console.error(err); process.exit(1); });
