/**
 * Accepts the various ways "did they pass" shows up in a spreadsheet:
 * true/false, 1/0, pass/fail, passed/failed, p/f - case-insensitive.
 * Anything else is treated as false (fail) rather than throwing, so one
 * malformed cell in a CSV doesn't abort the whole upload.
 */
function parsePassed(value) {
  return /^(true|1|pass|passed|p)$/i.test(String(value).trim());
}

module.exports = { parsePassed };
