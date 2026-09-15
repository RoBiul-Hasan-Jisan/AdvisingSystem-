const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/me', require('./routes/me'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/sections', require('./routes/sections'));
app.use('/api/enrollment', require('./routes/enrollment'));
app.use('/api/routines', require('./routes/routines'));
app.use('/api/terms', require('./routes/terms'));
app.use('/api/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
