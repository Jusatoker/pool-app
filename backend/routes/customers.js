const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all customers
router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM customers ORDER BY name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single customer with pools, equipment, recent jobs
router.get('/:id', async (req, res) => {
  try {
    const c = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Not found' });
    const pools = await pool.query('SELECT * FROM pools WHERE customer_id = $1 ORDER BY name', [req.params.id]);
    const equip = await pool.query('SELECT * FROM equipment WHERE customer_id = $1 ORDER BY equipment_type', [req.params.id]);
    const jobs = await pool.query('SELECT j.*, u.full_name as tech_name FROM jobs j LEFT JOIN users u ON j.tech_id = u.id WHERE j.customer_id = $1 ORDER BY j.scheduled_date DESC LIMIT 20', [req.params.id]);
    const invoices = await pool.query('SELECT * FROM invoices WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20', [req.params.id]);
    const photos = await pool.query('SELECT * FROM customer_photos WHERE customer_id = $1 ORDER BY uploaded_at DESC', [req.params.id]);
    res.json({ ...c.rows[0], pools: pools.rows, equipment: equip.rows, jobs: jobs.rows, invoices: invoices.rows, photos: photos.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create customer
router.post('/', async (req, res) => {
  try {
    const { name, address, city, state, zip, phone, email, billing_rate, billing_frequency, notes } = req.body;
    const r = await pool.query(
      `INSERT INTO customers (name, address, city, state, zip, phone, email, billing_rate, billing_frequency, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, address, city, state || 'TN', zip, phone, email, billing_rate, billing_frequency || 'monthly', notes]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update customer
router.put('/:id', async (req, res) => {
  try {
    const { name, address, city, state, zip, phone, email, billing_rate, billing_frequency, auto_pay, notes, is_active } = req.body;
    const r = await pool.query(
      `UPDATE customers SET name=$1, address=$2, city=$3, state=$4, zip=$5, phone=$6, email=$7, billing_rate=$8, billing_frequency=$9, auto_pay=$10, notes=$11, is_active=$12
       WHERE id=$13 RETURNING *`,
      [name, address, city, state, zip, phone, email, billing_rate, billing_frequency, auto_pay, notes, is_active, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE customer
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === POOLS ===
router.post('/:id/pools', async (req, res) => {
  try {
    const { name, pool_type, size_gallons, surface_type, pump_model, filter_type, heater_type, chlorine_type, notes } = req.body;
    const r = await pool.query(
      `INSERT INTO pools (customer_id, name, pool_type, size_gallons, surface_type, pump_model, filter_type, heater_type, chlorine_type, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, name || 'Main Pool', pool_type, size_gallons, surface_type, pump_model, filter_type, heater_type, chlorine_type, notes]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/pools/:pid', async (req, res) => {
  try {
    const { name, pool_type, size_gallons, surface_type, pump_model, filter_type, heater_type, chlorine_type, notes } = req.body;
    const r = await pool.query(
      `UPDATE pools SET name=$1, pool_type=$2, size_gallons=$3, surface_type=$4, pump_model=$5, filter_type=$6, heater_type=$7, chlorine_type=$8, notes=$9 WHERE id=$10 RETURNING *`,
      [name, pool_type, size_gallons, surface_type, pump_model, filter_type, heater_type, chlorine_type, notes, req.params.pid]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/pools/:pid', async (req, res) => {
  try {
    await pool.query('DELETE FROM pools WHERE id = $1', [req.params.pid]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
