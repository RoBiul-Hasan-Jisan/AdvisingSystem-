const test = require('node:test');
const assert = require('node:assert/strict');
const { asyncHandler } = require('../middleware/asyncHandler');
const { notFound, errorHandler } = require('../middleware/errorHandler');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

// --- asyncHandler ---

test('asyncHandler calls through normally when the handler resolves', async () => {
  const handler = asyncHandler(async (req, res) => { res.json({ ok: true }); });
  const res = fakeRes();
  let nextCalled = false;
  await handler({}, res, () => { nextCalled = true; });
  assert.deepEqual(res.body, { ok: true });
  assert.equal(nextCalled, false);
});

test('asyncHandler forwards a rejected promise to next(err) instead of hanging', async () => {
  const boom = new Error('boom');
  const handler = asyncHandler(async () => { throw boom; });
  const res = fakeRes();
  let caught = null;
  await handler({}, res, (err) => { caught = err; });
  assert.equal(caught, boom);
});

test('asyncHandler forwards a synchronous throw too (not just async rejection)', async () => {
  // an async function that throws synchronously still returns a rejected
  // promise under the hood, but this confirms the wrapper handles it either way
  const handler = asyncHandler((req, res) => { throw new Error('sync boom'); });
  const res = fakeRes();
  let caught = null;
  await handler({}, res, (err) => { caught = err; });
  assert.equal(caught.message, 'sync boom');
});

// --- notFound ---

test('notFound responds 404 with the method and path', () => {
  const res = fakeRes();
  notFound({ method: 'GET', originalUrl: '/api/nonsense' }, res);
  assert.equal(res.statusCode, 404);
  assert.match(res.body.error, /GET \/api\/nonsense/);
});

// --- errorHandler ---

test('errorHandler maps a CastError to 400', () => {
  const res = fakeRes();
  errorHandler({ name: 'CastError', path: '_id', value: 'not-an-id' }, {}, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /_id/);
});

test('errorHandler maps a ValidationError to 400 with combined messages', () => {
  const res = fakeRes();
  const err = {
    name: 'ValidationError',
    errors: {
      title: { message: 'title is required' },
      credits: { message: 'credits must be a number' }
    }
  };
  errorHandler(err, {}, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /title is required/);
  assert.match(res.body.error, /credits must be a number/);
});

test('errorHandler maps a duplicate-key error (11000) to 409', () => {
  const res = fakeRes();
  errorHandler({ code: 11000, keyValue: { code: 'CSE221' } }, {}, res, () => {});
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /code/);
});

test('errorHandler maps a Multer file-size error to 400', () => {
  const res = fakeRes();
  errorHandler({ code: 'LIMIT_FILE_SIZE' }, {}, res, () => {});
  assert.equal(res.statusCode, 400);
});

test('errorHandler falls back to 500 for anything unrecognized, without leaking internals', () => {
  const res = fakeRes();
  errorHandler(new Error('some internal detail about our stack'), {}, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(res.body.error, /internal detail/);
});
