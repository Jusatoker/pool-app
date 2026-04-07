const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');

// GET all users (no password hashes)
router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, username, full_name, role, phone, email, is_active, created_at FROM users ORDER BY full_name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create user
router.post('/', async (req, res) => {
  try {
    const { username, password, full_name, role, phone, email } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role, phone, email)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, username, full_name, role, phone, email, is_active, created_at`,
      [username, hash, full_name, role || 'tech', phone, email]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Username already taken' });
    res.status(500).json({ error: err.message });
  }
});

// PUT update user
router.put('/:id', async (req, res) => {
  try {
    const { full_name, role, phone, email, is_active } = req.body;
    const r = await pool.query(
      `UPDATE users SET full_name=$1, role=$2, phone=$3, email=$4, is_active=$5 WHERE id=$6
       RETURNING id, username, full_name, role, phone, email, is_active, created_at`,
      [full_name, role, phone, email, is_active, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT reset password
router.put('/:id/password', async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 chars' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE user
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
