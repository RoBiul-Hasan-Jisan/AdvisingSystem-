const test = require('node:test');
const assert = require('node:assert/strict');
const { securityHeaders } = require('../middleware/security');

function fakeRes() {
  return {
    headers: {},
    set(key, value) { this.headers[key] = value; }
  };
}

test('sets the expected security headers and calls next', () => {
  const res = fakeRes();
  let nextCalled = false;
  securityHeaders({}, res, () => { nextCalled = true; });

  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'DENY');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(nextCalled, true);
});
