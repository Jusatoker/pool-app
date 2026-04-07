const express = require('express');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Job photos
const jobStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'jobs');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
  }
});
const jobUpload = multer({ storage: jobStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// Customer photos
const custStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'customers');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
  }
});
const custUpload = multer({ storage: custStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// === JOB PHOTOS ===
router.get('/jobs/:jid', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM job_photos WHERE job_id = $1 ORDER BY phase, uploaded_at', [req.params.jid]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/:jid', jobUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = '/uploads/jobs/' + req.file.filename;
    const phase = req.body.phase || 'other';
    const caption = req.body.caption || '';
    const r = await pool.query(
      `INSERT INTO job_photos (job_id, phase, file_path, caption) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.jid, phase, filePath, caption]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/jobs/photo/:pid', async (req, res) => {
  try {
    const photo = await pool.query('SELECT file_path FROM job_photos WHERE id = $1', [req.params.pid]);
    if (photo.rows[0]) {
      const fullPath = path.join(__dirname, '..', photo.rows[0].file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    await pool.query('DELETE FROM job_photos WHERE id = $1', [req.params.pid]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === CUSTOMER PHOTOS ===
router.get('/customers/:cid', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM customer_photos WHERE customer_id = $1 ORDER BY uploaded_at DESC', [req.params.cid]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/customers/:cid', custUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = '/uploads/customers/' + req.file.filename;
    const caption = req.body.caption || '';
    const r = await pool.query(
      `INSERT INTO customer_photos (customer_id, file_path, caption) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.cid, filePath, caption]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/customers/photo/:pid', async (req, res) => {
  try {
    const photo = await pool.query('SELECT file_path FROM customer_photos WHERE id = $1', [req.params.pid]);
    if (photo.rows[0]) {
      const fullPath = path.join(__dirname, '..', photo.rows[0].file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    await pool.query('DELETE FROM customer_photos WHERE id = $1', [req.params.pid]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
