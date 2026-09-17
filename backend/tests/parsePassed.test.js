const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePassed } = require('../src/utils/parsePassed');

test('recognizes common truthy spellings', () => {
  for (const v of ['true', 'TRUE', '1', 'pass', 'Pass', 'passed', 'PASSED', 'p', 'P']) {
    assert.equal(parsePassed(v), true, `expected "${v}" to parse as passed`);
  }
});

test('recognizes common falsy spellings', () => {
  for (const v of ['false', 'FALSE', '0', 'fail', 'failed', 'f', 'F', '', 'n/a']) {
    assert.equal(parsePassed(v), false, `expected "${v}" to parse as not passed`);
  }
});

test('tolerates surrounding whitespace', () => {
  assert.equal(parsePassed('  true  '), true);
  assert.equal(parsePassed(' pass '), true);
});

test('treats garbage input as false rather than throwing', () => {
  assert.equal(parsePassed(undefined), false);
  assert.equal(parsePassed(null), false);
  assert.equal(parsePassed('maybe'), false);
});
