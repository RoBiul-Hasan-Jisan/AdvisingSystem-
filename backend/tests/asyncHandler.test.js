const test = require('node:test');
const assert = require('node:assert/strict');
const asyncHandler = require('../src/utils/asyncHandler');

test('calls the wrapped handler normally when it resolves', async () => {
  let called = false;
  const handler = asyncHandler(async (req, res) => {
    called = true;
    res.json({ ok: true });
  });
  const res = { json: () => {} };
  await handler({}, res, () => {});
  assert.equal(called, true);
});

test('forwards a thrown/rejected error to next() instead of crashing', async () => {
  const boom = new Error('boom');
  const handler = asyncHandler(async () => {
    throw boom;
  });
  let passedToNext = null;
  await handler({}, {}, (err) => {
    passedToNext = err;
  });
  assert.equal(passedToNext, boom);
});
