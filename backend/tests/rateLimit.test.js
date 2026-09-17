const test = require('node:test');
const assert = require('node:assert/strict');
const rateLimit = require('../src/middleware/rateLimit');

function mockReqRes(ip = '1.2.3.4') {
  const req = { ip };
  const headers = {};
  const res = {
    statusCode: null,
    body: null,
    set(key, value) {
      headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    headers,
  };
  return { req, res };
}

test('allows requests under the limit', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 3 });
  let calledNext = 0;
  const next = () => calledNext++;

  for (let i = 0; i < 3; i++) {
    const { req, res } = mockReqRes();
    limiter(req, res, next);
  }
  assert.equal(calledNext, 3);
});

test('blocks the request once the limit is exceeded, with a 429 and Retry-After', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 2 });
  const next = () => {};

  limiter(mockReqRes().req, mockReqRes().res, next); // these use separate mocks, so key by shared ip instead
  const key = '9.9.9.9';
  const calls = [mockReqRes(key), mockReqRes(key), mockReqRes(key)];
  calls.forEach(({ req, res }) => limiter(req, res, next));

  assert.equal(calls[0].res.statusCode, null); // allowed
  assert.equal(calls[1].res.statusCode, null); // allowed
  assert.equal(calls[2].res.statusCode, 429); // blocked
  assert.equal(calls[2].res.body.error, 'Too many requests. Please slow down and try again shortly.');
  assert.ok(calls[2].res.headers['Retry-After']);
});

test('tracks separate keys independently', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1 });
  const next = () => {};

  const a1 = mockReqRes('a');
  limiter(a1.req, a1.res, next);
  const b1 = mockReqRes('b');
  limiter(b1.req, b1.res, next);

  assert.equal(a1.res.statusCode, null);
  assert.equal(b1.res.statusCode, null);

  const a2 = mockReqRes('a');
  limiter(a2.req, a2.res, next);
  assert.equal(a2.res.statusCode, 429);
});
