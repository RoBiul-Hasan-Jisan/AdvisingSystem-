const express = require('express');
const Term = require('../models/Term');
const Config = require('../models/Config');
const { getCurrentTerm } = require('../utils/currentTerm');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { logAction } = require('../utils/auditLog');

const router = express.Router();

// GET /api/terms/current - which term the whole app should default to.
// Frontend calls this once instead of hardcoding a term string anywhere.
router.get(
  '/current',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ currentTerm: await getCurrentTerm() });
  })
);

// PUT /api/terms/current   body: { term } - admin flips which term is active
// (e.g. after importing next term's PDF early, before it actually starts).
router.put(
  '/current',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { term } = req.body;
    if (!term) return res.status(400).json({ error: 'term is required' });
    const config = await Config.findOneAndUpdate(
      { key: 'currentTerm' },
      { value: term },
      { upsert: true, new: true }
    );
    await logAction(req.dbUser, 'term.set-current', { term: config.value });
    res.json({ currentTerm: config.value });
  })
);

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
    await logAction(req.dbUser, 'term.window-set', { program: doc.program, term: doc.term, enrollmentStart, enrollmentEnd, creditLimit });
    res.json(doc);
  })
);

module.exports = router;
