const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../middleware/rateLimit');

// Minimal fake Express req/res for testing the middleware in isolation.
function fakeReqRes(ip = '1.2.3.4') {
  const req = { ip };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    set(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  return { req, res };
}

test('allows requests under the limit', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 3 });
  let nextCalled = 0;
  for (let i = 0; i < 3; i++) {
    const { req, res } = fakeReqRes();
    limiter(req, res, () => { nextCalled++; });
  }
  assert.equal(nextCalled, 3);
});

test('blocks the request once the limit is exceeded, with a 429', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 2 });
  const results = [];
  for (let i = 0; i < 3; i++) {
    const { req, res } = fakeReqRes();
    let called = false;
    limiter(req, res, () => { called = true; });
    results.push({ called, status: res.statusCode, body: res.body });
  }
  assert.equal(results[0].called, true);
  assert.equal(results[1].called, true);
  assert.equal(results[2].called, false);
  assert.equal(results[2].status, 429);
  assert.match(results[2].body.error, /too many requests/i);
});

test('tracks separate keys independently (per-IP by default)', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1 });
  const a1 = fakeReqRes('1.1.1.1');
  const b1 = fakeReqRes('2.2.2.2');
  let aCalled = false, bCalled = false;
  limiter(a1.req, a1.res, () => { aCalled = true; });
  limiter(b1.req, b1.res, () => { bCalled = true; });
  assert.equal(aCalled, true);
  assert.equal(bCalled, true); // different IP, independent budget

  const a2 = fakeReqRes('1.1.1.1');
  let a2Called = false;
  limiter(a2.req, a2.res, () => { a2Called = true; });
  assert.equal(a2Called, false); // same IP as a1, budget of 1 already used
});

test('supports a custom keyFn (e.g. per-user instead of per-IP)', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1, keyFn: (req) => req.userId });
  const { req: reqA, res: resA } = fakeReqRes();
  reqA.userId = 'user-1';
  const { req: reqB, res: resB } = fakeReqRes(); // same IP as reqA on purpose
  reqB.userId = 'user-2';

  let aCalled = false, bCalled = false;
  limiter(reqA, resA, () => { aCalled = true; });
  limiter(reqB, resB, () => { bCalled = true; });
  assert.equal(aCalled, true);
  assert.equal(bCalled, true); // different userId, so different key despite same IP
});
