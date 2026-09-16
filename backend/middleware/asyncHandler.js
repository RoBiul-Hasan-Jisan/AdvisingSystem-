// Express 4 does not catch a rejected promise thrown inside an async route
// handler - without this, a Mongoose error (bad ObjectId, validation
// failure, whatever) just leaves the request hanging forever with no
// response, instead of reaching the error middleware below. Wrap every
// async handler with this so failures actually produce a response.
function asyncHandler(fn) {
  return function (req, res, next) {
    try {
      Promise.resolve(fn(req, res, next)).catch(next);
    } catch (err) {
      // fn threw synchronously (not just returned a rejected promise) -
      // Promise.resolve() never gets called in that case, so this needs
      // its own catch, not just the .catch() above.
      next(err);
    }
  };
}

module.exports = { asyncHandler };
