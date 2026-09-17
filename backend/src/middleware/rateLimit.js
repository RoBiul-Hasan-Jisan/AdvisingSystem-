/**
 * Minimal in-memory sliding-window rate limiter. Tracks request timestamps
 * per key and rejects once the count in the window is exceeded.
 *
 * NOTE: in-memory means limits reset on process restart and don't share
 * state across multiple instances behind a load balancer - fine for a
 * single-instance deployment; swap for a Redis-backed limiter if this ever
 * runs as more than one process.
 */
function rateLimit({ windowMs = 60_000, max = 60, keyFn = (req) => req.ip } = {}) {
  const hits = new Map(); // key -> array of timestamps

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits.entries()) {
      const kept = timestamps.filter((t) => t > cutoff);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }, windowMs);
  cleanup.unref();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const cutoff = now - windowMs;

    const timestamps = (hits.get(key) || []).filter((t) => t > cutoff);
    if (timestamps.length >= max) {
      const retryAfterMs = timestamps[0] + windowMs - now;
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}

module.exports = rateLimit;
