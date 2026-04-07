const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all invoices
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT i.*, c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); sql += ` AND i.status = $${params.length}`; }
    sql += ' ORDER BY i.created_at DESC';
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single invoice with line items and payments
router.get('/:id', async (req, res) => {
  try {
    const i = await pool.query(
      `SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = $1`, [req.params.id]);
    if (!i.rows[0]) return res.status(404).json({ error: 'Not found' });
    const items = await pool.query('SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY sort_order', [req.params.id]);
    const payments = await pool.query('SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date DESC', [req.params.id]);
    res.json({ ...i.rows[0], line_items: items.rows, payments: payments.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create invoice (standalone, not from job)
router.post('/', async (req, res) => {
  try {
    const { customer_id, due_date, notes } = req.body;
    const countR = await pool.query('SELECT COUNT(*) FROM invoices');
    const invNum = 'FP-' + String(parseInt(countR.rows[0].count) + 1001).padStart(5, '0');
    const r = await pool.query(
      `INSERT INTO invoices (customer_id, invoice_number, due_date, notes)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE + 30), $4) RETURNING *`,
      [customer_id, invNum, due_date, notes]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update invoice
router.put('/:id', async (req, res) => {
  try {
    const { status, tax_rate, notes, due_date } = req.body;
    // Recalculate totals
    const totR = await pool.query('SELECT COALESCE(SUM(line_total), 0) as subtotal FROM invoice_line_items WHERE invoice_id = $1', [req.params.id]);
    const subtotal = parseFloat(totR.rows[0].subtotal);
    const taxRate = tax_rate || 0;
    const taxAmt = subtotal * (taxRate / 100);
    const total = subtotal + taxAmt;
    const paidR = await pool.query('SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE invoice_id = $1', [req.params.id]);
    const paid = parseFloat(paidR.rows[0].paid);
    const balance = total - paid;

    const r = await pool.query(
      `UPDATE invoices SET status=$1, tax_rate=$2, tax_amount=$3, subtotal=$4, total=$5, amount_paid=$6, balance_due=$7, notes=$8, due_date=COALESCE($9, due_date)
       WHERE id=$10 RETURNING *`,
      [status, taxRate, taxAmt, subtotal, total, paid, balance, notes, due_date, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST send invoice (mark as sent)
router.post('/:id/send', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE invoices SET status = 'sent', sent_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === LINE ITEMS ===
router.post('/:id/items', async (req, res) => {
  try {
    const { description, quantity, unit_price, item_type } = req.body;
    const lineTotal = (quantity || 1) * (unit_price || 0);
    const sortR = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM invoice_line_items WHERE invoice_id = $1', [req.params.id]);
    const r = await pool.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, item_type, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, description, quantity || 1, unit_price || 0, lineTotal, item_type, sortR.rows[0].next]
    );
    // Update invoice totals
    await recalcInvoice(req.params.id);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/items/:iid', async (req, res) => {
  try {
    const { description, quantity, unit_price, item_type } = req.body;
    const lineTotal = (quantity || 1) * (unit_price || 0);
    const r = await pool.query(
      `UPDATE invoice_line_items SET description=$1, quantity=$2, unit_price=$3, line_total=$4, item_type=$5
       WHERE id=$6 RETURNING *`,
      [description, quantity, unit_price, lineTotal, item_type, req.params.iid]
    );
    // Get invoice_id to recalc
    if (r.rows[0]) await recalcInvoice(r.rows[0].invoice_id);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/items/:iid', async (req, res) => {
  try {
    const item = await pool.query('SELECT invoice_id FROM invoice_line_items WHERE id = $1', [req.params.iid]);
    await pool.query('DELETE FROM invoice_line_items WHERE id = $1', [req.params.iid]);
    if (item.rows[0]) await recalcInvoice(item.rows[0].invoice_id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === PAYMENTS ===
router.post('/:id/payments', async (req, res) => {
  try {
    const { amount, method, reference_note } = req.body;
    const r = await pool.query(
      `INSERT INTO payments (invoice_id, amount, method, reference_note) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, amount, method, reference_note]
    );
    // Update invoice
    const inv = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    const newPaid = parseFloat(inv.rows[0].amount_paid || 0) + parseFloat(amount);
    const newBalance = parseFloat(inv.rows[0].total || 0) - newPaid;
    const newStatus = newBalance <= 0 ? 'paid' : inv.rows[0].status;
    await pool.query(
      `UPDATE invoices SET amount_paid = $1, balance_due = $2, status = $3, paid_at = CASE WHEN $3 = 'paid' THEN NOW() ELSE paid_at END WHERE id = $4`,
      [newPaid, Math.max(0, newBalance), newStatus, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function recalcInvoice(invoiceId) {
  const totR = await pool.query('SELECT COALESCE(SUM(line_total), 0) as subtotal FROM invoice_line_items WHERE invoice_id = $1', [invoiceId]);
  const subtotal = parseFloat(totR.rows[0].subtotal);
  const inv = await pool.query('SELECT tax_rate, amount_paid FROM invoices WHERE id = $1', [invoiceId]);
  const taxRate = parseFloat(inv.rows[0]?.tax_rate || 0);
  const taxAmt = subtotal * (taxRate / 100);
  const total = subtotal + taxAmt;
  const paid = parseFloat(inv.rows[0]?.amount_paid || 0);
  const balance = total - paid;
  await pool.query(
    `UPDATE invoices SET subtotal=$1, tax_amount=$2, total=$3, balance_due=$4 WHERE id=$5`,
    [subtotal, taxAmt, total, Math.max(0, balance), invoiceId]
  );
}

module.exports = router;
