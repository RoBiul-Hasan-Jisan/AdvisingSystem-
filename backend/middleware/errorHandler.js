// Catches any request that didn't match a route above it.
function notFound(req, res) {
  res.status(404).json({ error: `No route: ${req.method} ${req.originalUrl}` });
}

// Central error handler - must be registered LAST, after every route, and
// must keep all four params (err, req, res, next) even though next is
// unused, or Express won't recognize it as an error handler at all.
function errorHandler(err, req, res, next) {
  // A malformed ObjectId (e.g. GET /api/sections/not-a-real-id) throws this -
  // it's a client mistake, not a server failure, so 400 not 500.
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid ${err.path}: ${err.value}` });
  }

  // Mongoose schema validation failures (missing required field, bad enum value, etc)
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ error: messages.join('; ') });
  }

  // Duplicate key (violates a unique index - e.g. re-adding a course code
  // that already exists, or double-creating the same section)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {}).join(', ');
    return res.status(409).json({ error: `Already exists: ${field}` });
  }

  // Multer's file-size-limit error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File is too large.' });
  }

  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: 'Something went wrong on our end. Please try again.' });
}

module.exports = { notFound, errorHandler };
