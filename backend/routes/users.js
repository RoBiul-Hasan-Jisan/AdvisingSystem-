const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/auditLog');
const { asyncHandler } = require('../middleware/asyncHandler');

/**
 * GET /api/users/me
 * Any logged-in user - returns their own profile (used by the frontend
 * right after login to decide which dashboard to route to).
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json(req.user);
}));

/**
 * GET /api/users?role=student
 * Admin only - list/filter accounts (e.g. to build a result-upload sheet).
 */
router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.semester) filter.currentSemester = Number(req.query.semester);
  const users = await User.find(filter).sort('name');
  res.json(users);
}));

/**
 * POST /api/users
 * Admin only - provisions a new account. Creates the Firebase auth user
 * (if a temp password is given) AND the matching Mongo profile in one call,
 * so admin never has to touch the Firebase console directly.
 * body: { name, email, password, role, studentId?, currentSemester? }
 *
 * Keeps its own try/catch (rather than relying on the central error handler)
 * because Firebase Admin SDK errors (e.g. "email already in use") have a
 * different shape than Mongoose errors and carry a genuinely useful message
 * for the admin - the generic error handler's fallback would hide it.
 */
router.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, email, password, role, studentId, currentSemester } = req.body;
  if (!['admin', 'teacher', 'student'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin, teacher or student' });
  }

  try {
    const firebaseUser = await admin.auth().createUser({ email, password, displayName: name });

    const user = await User.create({
      firebaseUid: firebaseUser.uid,
      name,
      email,
      role,
      ...(role === 'student' ? { studentId, currentSemester: currentSemester || 1 } : {})
    });

    await logAction(req.user, 'user.create', { name: user.name, email: user.email, role: user.role });
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

/**
 * PUT /api/users/:id
 * Admin only - edit role, manually override a student's currentSemester
 * (e.g. transfer student, manual correction outside the normal promotion flow).
 */
router.put('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, role, studentId, currentSemester } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { ...(name && { name }), ...(role && { role }), ...(studentId && { studentId }), ...(currentSemester && { currentSemester }) },
    { new: true, runValidators: true }
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  await logAction(req.user, 'user.update', { targetUser: user.email, changes: req.body });
  res.json(user);
}));

/**
 * DELETE /api/users/:id
 * Admin only - removes both the Firebase login and the Mongo profile.
 */
router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  await admin.auth().deleteUser(user.firebaseUid).catch(() => {}); // ignore if already gone
  await user.deleteOne();
  await logAction(req.user, 'user.delete', { targetUser: user.email, role: user.role });
  res.json({ message: 'User removed' });
}));

module.exports = router;
