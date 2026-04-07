const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all jobs (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { status, date, tech_id, customer_id } = req.query;
    let sql = `SELECT j.*, c.name as customer_name, c.address as customer_address, u.full_name as tech_name
               FROM jobs j
               LEFT JOIN customers c ON j.customer_id = c.id
               LEFT JOIN users u ON j.tech_id = u.id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); sql += ` AND j.status = $${params.length}`; }
    if (date) { params.push(date); sql += ` AND j.scheduled_date = $${params.length}`; }
    if (tech_id) { params.push(tech_id); sql += ` AND j.tech_id = $${params.length}`; }
    if (customer_id) { params.push(customer_id); sql += ` AND j.customer_id = $${params.length}`; }
    sql += ' ORDER BY j.scheduled_date DESC, j.scheduled_time';
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single job with all details
router.get('/:id', async (req, res) => {
  try {
    const j = await pool.query(
      `SELECT j.*, c.name as customer_name, c.address as customer_address, c.phone as customer_phone,
              u.full_name as tech_name
       FROM jobs j LEFT JOIN customers c ON j.customer_id = c.id LEFT JOIN users u ON j.tech_id = u.id
       WHERE j.id = $1`, [req.params.id]);
    if (!j.rows[0]) return res.status(404).json({ error: 'Not found' });
    const chemicals = await pool.query('SELECT * FROM job_chemicals WHERE job_id = $1', [req.params.id]);
    const parts = await pool.query('SELECT * FROM job_parts WHERE job_id = $1', [req.params.id]);
    const photos = await pool.query('SELECT * FROM job_photos WHERE job_id = $1 ORDER BY phase, uploaded_at', [req.params.id]);
    const readings = await pool.query('SELECT * FROM water_readings WHERE job_id = $1', [req.params.id]);
    res.json({ ...j.rows[0], chemicals: chemicals.rows, parts: parts.rows, photos: photos.rows, water_readings: readings.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create job
router.post('/', async (req, res) => {
  try {
    const { customer_id, pool_id, tech_id, job_type, scheduled_date, scheduled_time, description, internal_notes, labor_rate, flat_rate } = req.body;
    const r = await pool.query(
      `INSERT INTO jobs (customer_id, pool_id, tech_id, job_type, scheduled_date, scheduled_time, description, internal_notes, labor_rate, flat_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [customer_id, pool_id, tech_id, job_type, scheduled_date, scheduled_time, description, internal_notes, labor_rate, flat_rate]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update job
router.put('/:id', async (req, res) => {
  try {
    const { customer_id, pool_id, tech_id, job_type, status, scheduled_date, scheduled_time, description, internal_notes, labor_hours, labor_rate, flat_rate } = req.body;
    const r = await pool.query(
      `UPDATE jobs SET customer_id=$1, pool_id=$2, tech_id=$3, job_type=$4, status=$5, scheduled_date=$6, scheduled_time=$7, description=$8, internal_notes=$9, labor_hours=$10, labor_rate=$11, flat_rate=$12 WHERE id=$13 RETURNING *`,
      [customer_id, pool_id, tech_id, job_type, status, scheduled_date, scheduled_time, description, internal_notes, labor_hours, labor_rate, flat_rate, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST start job
router.post('/:id/start', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE jobs SET status = 'in-progress', started_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST complete job — auto-generate invoice
router.post('/:id/complete', async (req, res) => {
  try {
    const { labor_hours } = req.body;
    // Mark job complete
    const jr = await pool.query(
      `UPDATE jobs SET status = 'completed', completed_at = NOW(), labor_hours = COALESCE($2, labor_hours)
       WHERE id = $1 RETURNING *`,
      [req.params.id, labor_hours]
    );
    const job = jr.rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Generate invoice number
    const countR = await pool.query('SELECT COUNT(*) FROM invoices');
    const invNum = 'FP-' + String(parseInt(countR.rows[0].count) + 1001).padStart(5, '0');

    // Create invoice
    const invR = await pool.query(
      `INSERT INTO invoices (customer_id, job_id, invoice_number, status, due_date)
       VALUES ($1, $2, $3, 'draft', CURRENT_DATE + 30) RETURNING *`,
      [job.customer_id, job.id, invNum]
    );
    const invoice = invR.rows[0];

    // Add line items from job
    let sortOrder = 0;

    // Flat rate or labor
    if (job.flat_rate && job.flat_rate > 0) {
      await pool.query(
        `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, item_type, sort_order)
         VALUES ($1, $2, 1, $3, $3, 'service', $4)`,
        [invoice.id, job.job_type.charAt(0).toUpperCase() + job.job_type.slice(1) + ' service', job.flat_rate, sortOrder++]
      );
    } else if (job.labor_hours && job.labor_rate) {
      const laborTotal = job.labor_hours * job.labor_rate;
      await pool.query(
        `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, item_type, sort_order)
         VALUES ($1, $2, $3, $4, $5, 'labor', $6)`,
        [invoice.id, 'Labor', job.labor_hours, job.labor_rate, laborTotal, sortOrder++]
      );
    }

    // Chemicals
    const chems = await pool.query('SELECT * FROM job_chemicals WHERE job_id = $1', [job.id]);
    for (const c of chems.rows) {
      await pool.query(
        `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, item_type, sort_order)
         VALUES ($1, $2, $3, $4, $5, 'chemical', $6)`,
        [invoice.id, c.chemical_name, c.quantity, c.sell_price, c.quantity * c.sell_price, sortOrder++]
      );
    }

    // Parts
    const parts = await pool.query('SELECT * FROM job_parts WHERE job_id = $1', [job.id]);
    for (const p of parts.rows) {
      await pool.query(
        `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, item_type, sort_order)
         VALUES ($1, $2, $3, $4, $5, 'part', $6)`,
        [invoice.id, p.part_name, p.quantity, p.sell_each, p.quantity * p.sell_each, sortOrder++]
      );
    }

    // Calculate totals
    const totR = await pool.query('SELECT COALESCE(SUM(line_total), 0) as subtotal FROM invoice_line_items WHERE invoice_id = $1', [invoice.id]);
    const subtotal = parseFloat(totR.rows[0].subtotal);
    await pool.query(
      `UPDATE invoices SET subtotal = $1, total = $1, balance_due = $1 WHERE id = $2`,
      [subtotal, invoice.id]
    );

    // Link invoice to job
    await pool.query('UPDATE jobs SET invoice_id = $1 WHERE id = $2', [invoice.id, job.id]);

    res.json({ job: jr.rows[0], invoice: { ...invoice, subtotal, total: subtotal, balance_due: subtotal } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE job
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === JOB CHEMICALS ===
router.post('/:id/chemicals', async (req, res) => {
  try {
    const { chemical_name, quantity, unit, cost, sell_price } = req.body;
    const r = await pool.query(
      `INSERT INTO job_chemicals (job_id, chemical_name, quantity, unit, cost, sell_price)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, chemical_name, quantity, unit || 'oz', cost || 0, sell_price || 0]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/chemicals/:cid', async (req, res) => {
  try {
    await pool.query('DELETE FROM job_chemicals WHERE id = $1', [req.params.cid]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === JOB PARTS ===
router.post('/:id/parts', async (req, res) => {
  try {
    const { part_name, truck_inventory_id, quantity, cost_each, sell_each, source } = req.body;
    // Deduct from truck stock if source is truck
    if (source === 'truck' && truck_inventory_id) {
      await pool.query('UPDATE truck_inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE id = $2', [quantity || 1, truck_inventory_id]);
    }
    const r = await pool.query(
      `INSERT INTO job_parts (job_id, part_name, truck_inventory_id, quantity, cost_each, sell_each, source, order_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, part_name, truck_inventory_id, quantity || 1, cost_each || 0, sell_each || 0, source || 'truck', source === 'ordered' ? 'pending' : null]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/parts/:pid', async (req, res) => {
  try {
    await pool.query('DELETE FROM job_parts WHERE id = $1', [req.params.pid]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === WATER READINGS ===
router.post('/:id/readings', async (req, res) => {
  try {
    const { free_chlorine, total_chlorine, ph, alkalinity, calcium_hardness, cya, salt_level, temperature, notes } = req.body;
    const job = await pool.query('SELECT customer_id FROM jobs WHERE id = $1', [req.params.id]);
    const r = await pool.query(
      `INSERT INTO water_readings (job_id, customer_id, free_chlorine, total_chlorine, ph, alkalinity, calcium_hardness, cya, salt_level, temperature, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.id, job.rows[0]?.customer_id, free_chlorine, total_chlorine, ph, alkalinity, calcium_hardness, cya, salt_level, temperature, notes]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
