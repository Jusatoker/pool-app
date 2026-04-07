const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all settings (filtered for safety)
router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT key, CASE WHEN key LIKE \'%key%\' OR key LIKE \'%secret%\' THEN \'***configured***\' ELSE value END as value FROM app_settings');
    const settings = {};
    r.rows.forEach(row => settings[row.key] = row.value);
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET check if key is set
router.get('/check/:key', async (req, res) => {
  try {
    const r = await pool.query('SELECT value FROM app_settings WHERE key = $1', [req.params.key]);
    res.json({ configured: !!(r.rows[0]?.value) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT upsert setting
router.put('/:key', async (req, res) => {
  try {
    const { value } = req.body;
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [req.params.key, value]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE setting
router.delete('/:key', async (req, res) => {
  try {
    await pool.query('DELETE FROM app_settings WHERE key = $1', [req.params.key]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
