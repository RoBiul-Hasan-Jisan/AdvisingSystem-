const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let initialized = false;

function initFirebase() {
  if (initialized) return admin;

  const svcPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (svcPath && fs.existsSync(path.resolve(svcPath))) {
    const serviceAccount = require(path.resolve(svcPath));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // Falls back to Application Default Credentials (useful in some hosting envs).
    admin.initializeApp();
  }

  initialized = true;
  return admin;
}

module.exports = initFirebase;
