const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all truck inventory
router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM truck_inventory ORDER BY category, name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET low-stock items
router.get('/low-stock', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM truck_inventory WHERE quantity_on_hand <= reorder_level ORDER BY name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST add item
router.post('/', async (req, res) => {
  try {
    const { name, category, unit, quantity_on_hand, reorder_level, cost_price, sell_price, notes } = req.body;
    const r = await pool.query(
      `INSERT INTO truck_inventory (name, category, unit, quantity_on_hand, reorder_level, cost_price, sell_price, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, category, unit || 'each', quantity_on_hand || 0, reorder_level || 2, cost_price || 0, sell_price || 0, notes]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update item
router.put('/:id', async (req, res) => {
  try {
    const { name, category, unit, quantity_on_hand, reorder_level, cost_price, sell_price, notes } = req.body;
    const r = await pool.query(
      `UPDATE truck_inventory SET name=$1, category=$2, unit=$3, quantity_on_hand=$4, reorder_level=$5, cost_price=$6, sell_price=$7, notes=$8 WHERE id=$9 RETURNING *`,
      [name, category, unit, quantity_on_hand, reorder_level, cost_price, sell_price, notes, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST restock
router.post('/:id/restock', async (req, res) => {
  try {
    const { quantity } = req.body;
    const r = await pool.query(
      `UPDATE truck_inventory SET quantity_on_hand = quantity_on_hand + $1 WHERE id = $2 RETURNING *`,
      [quantity, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE item
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM truck_inventory WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === CHEMICALS CATALOG ===
router.get('/chemicals', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM chemical_catalog ORDER BY category, name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/chemicals', async (req, res) => {
  try {
    const { name, category, unit, cost_per_unit, sell_per_unit } = req.body;
    const r = await pool.query(
      `INSERT INTO chemical_catalog (name, category, unit, cost_per_unit, sell_per_unit) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, category, unit || 'oz', cost_per_unit || 0, sell_per_unit || 0]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/chemicals/:id', async (req, res) => {
  try {
    const { name, category, unit, cost_per_unit, sell_per_unit } = req.body;
    const r = await pool.query(
      `UPDATE chemical_catalog SET name=$1, category=$2, unit=$3, cost_per_unit=$4, sell_per_unit=$5 WHERE id=$6 RETURNING *`,
      [name, category, unit, cost_per_unit, sell_per_unit, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/chemicals/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM chemical_catalog WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
