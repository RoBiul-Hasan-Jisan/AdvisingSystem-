const express = require('express');
const Term = require('../models/Term');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/terms?term=Summer 2026&program=CSE
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { term, program } = req.query;
    const filter = {};
    if (term) filter.term = term;
    if (program) filter.program = program.toUpperCase();
    res.json(await Term.find(filter));
  })
);

// PUT /api/terms/:program/:term - admin opens/adjusts a program's enrollment window
router.put(
  '/:program/:term',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { program, term } = req.params;
    const { enrollmentStart, enrollmentEnd, creditLimit } = req.body;
    const doc = await Term.findOneAndUpdate(
      { program: program.toUpperCase(), term },
      { program: program.toUpperCase(), term, enrollmentStart, enrollmentEnd, creditLimit },
      { upsert: true, new: true }
    );
    res.json(doc);
  })
);

module.exports = router;
