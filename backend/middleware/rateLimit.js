/**
 * Minimal in-memory sliding-window rate limiter. No external package (this
 * environment can't reach the npm registry to add express-rate-limit), but
 * the logic is the same idea: track request timestamps per key, reject once
 * the count in the window is exceeded.
 *
 * NOTE: in-memory means limits reset if the process restarts, and don't
 * share state across multiple server instances. Fine for a single-instance
 * deployment; swap for a Redis-backed limiter if you ever run more than one
 * backend process behind a load balancer.
 */
function rateLimit({ windowMs = 60_000, max = 60, keyFn = (req) => req.ip }) {
  const hits = new Map(); // key -> array of timestamps

  // periodic cleanup so the map doesn't grow forever
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits.entries()) {
      const kept = timestamps.filter(t => t > cutoff);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const cutoff = now - windowMs;

    const timestamps = (hits.get(key) || []).filter(t => t > cutoff);
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

module.exports = { rateLimit };
