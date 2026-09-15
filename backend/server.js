require('dotenv').config();
const connectDB = require('./src/config/db');
const app = require('./src/app');

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => app.listen(PORT, () => console.log(`[server] listening on :${PORT}`)))
  .catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
  });
