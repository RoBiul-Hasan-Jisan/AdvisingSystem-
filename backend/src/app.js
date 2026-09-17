const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());
app.use(morgan('dev'));

// General ceiling on the whole API, plus a tighter one on enrollment
// specifically - the highest-value endpoint to abuse (hammering
// enroll/drop to game the waitlist queue).
app.use('/api', rateLimit({ windowMs: 60_000, max: 120 }));
app.use('/api/enrollment', rateLimit({ windowMs: 60_000, max: 20 }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/me', require('./routes/me'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/sections', require('./routes/sections'));
app.use('/api/enrollment', require('./routes/enrollment'));
app.use('/api/routines', require('./routes/routines'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/audit-log', require('./routes/auditLog'));
app.use('/api/terms', require('./routes/terms'));
app.use('/api/admin/import', require('./routes/import'));
app.use('/api/admin', require('./routes/admin'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
