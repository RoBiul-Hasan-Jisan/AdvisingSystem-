// A hand-rolled subset of what the `helmet` package would give you - this
// environment can't reach the npm registry to install it, but these are the
// headers that actually matter for an API (as opposed to a page-serving
// server, which needs a few more like CSP).
function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff'); // stop browsers guessing content-type
  res.set('X-Frame-Options', 'DENY');            // this API should never be framed
  res.set('Referrer-Policy', 'no-referrer');
  next();
}

module.exports = { securityHeaders };
