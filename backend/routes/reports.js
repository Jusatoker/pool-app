const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET dashboard stats
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayJobs = await pool.query(
      `SELECT COUNT(*) as count FROM jobs WHERE scheduled_date = $1 AND status != 'cancelled'`, [today]);
    const openJobs = await pool.query(
      `SELECT COUNT(*) as count FROM jobs WHERE status IN ('scheduled', 'in-progress')`);
    const unpaidInv = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(balance_due), 0) as total FROM invoices WHERE status IN ('draft', 'sent', 'overdue')`);
    const monthRevenue = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE EXTRACT(MONTH FROM payment_date) = EXTRACT(MONTH FROM NOW()) AND EXTRACT(YEAR FROM payment_date) = EXTRACT(YEAR FROM NOW())`);
    const activeCustomers = await pool.query(
      `SELECT COUNT(*) as count FROM customers WHERE is_active = TRUE`);
    const lowStock = await pool.query(
      `SELECT COUNT(*) as count FROM truck_inventory WHERE quantity_on_hand <= reorder_level`);
    const recentPayments = await pool.query(
      `SELECT p.*, i.invoice_number, c.name as customer_name
       FROM payments p LEFT JOIN invoices i ON p.invoice_id = i.id LEFT JOIN customers c ON i.customer_id = c.id
       ORDER BY p.payment_date DESC LIMIT 5`);
    const todayJobList = await pool.query(
      `SELECT j.*, c.name as customer_name, c.address as customer_address, u.full_name as tech_name
       FROM jobs j LEFT JOIN customers c ON j.customer_id = c.id LEFT JOIN users u ON j.tech_id = u.id
       WHERE j.scheduled_date = $1 AND j.status != 'cancelled'
       ORDER BY j.scheduled_time`, [today]);

    res.json({
      today_jobs: parseInt(todayJobs.rows[0].count),
      open_jobs: parseInt(openJobs.rows[0].count),
      unpaid_invoices: parseInt(unpaidInv.rows[0].count),
      unpaid_total: parseFloat(unpaidInv.rows[0].total),
      month_revenue: parseFloat(monthRevenue.rows[0].total),
      active_customers: parseInt(activeCustomers.rows[0].count),
      low_stock_count: parseInt(lowStock.rows[0].count),
      recent_payments: recentPayments.rows,
      today_job_list: todayJobList.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET revenue report
router.get('/revenue', async (req, res) => {
  try {
    const { year, month } = req.query;
    const y = year || new Date().getFullYear();

    // Revenue by month
    const monthly = await pool.query(
      `SELECT EXTRACT(MONTH FROM payment_date) as month, COALESCE(SUM(amount), 0) as total
       FROM payments WHERE EXTRACT(YEAR FROM payment_date) = $1
       GROUP BY EXTRACT(MONTH FROM payment_date) ORDER BY month`, [y]);

    // Revenue by job type
    const byType = await pool.query(
      `SELECT j.job_type, COALESCE(SUM(p.amount), 0) as total
       FROM payments p JOIN invoices i ON p.invoice_id = i.id JOIN jobs j ON i.job_id = j.id
       WHERE EXTRACT(YEAR FROM p.payment_date) = $1
       GROUP BY j.job_type ORDER BY total DESC`, [y]);

    // Revenue by customer
    const byCustomer = await pool.query(
      `SELECT c.name, COALESCE(SUM(p.amount), 0) as total
       FROM payments p JOIN invoices i ON p.invoice_id = i.id JOIN customers c ON i.customer_id = c.id
       WHERE EXTRACT(YEAR FROM p.payment_date) = $1
       GROUP BY c.name ORDER BY total DESC LIMIT 20`, [y]);

    // Total
    const totalR = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE EXTRACT(YEAR FROM payment_date) = $1`, [y]);

    res.json({
      year: y,
      total: parseFloat(totalR.rows[0].total),
      by_month: monthly.rows,
      by_job_type: byType.rows,
      by_customer: byCustomer.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET AR aging report
router.get('/aging', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
              CURRENT_DATE - i.due_date as days_overdue
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.balance_due > 0 AND i.status != 'void'
       ORDER BY i.due_date`);

    const current = r.rows.filter(i => i.days_overdue <= 0);
    const over30 = r.rows.filter(i => i.days_overdue > 0 && i.days_overdue <= 30);
    const over60 = r.rows.filter(i => i.days_overdue > 30 && i.days_overdue <= 60);
    const over90 = r.rows.filter(i => i.days_overdue > 60);

    res.json({
      current: { invoices: current, total: current.reduce((s, i) => s + parseFloat(i.balance_due), 0) },
      over_30: { invoices: over30, total: over30.reduce((s, i) => s + parseFloat(i.balance_due), 0) },
      over_60: { invoices: over60, total: over60.reduce((s, i) => s + parseFloat(i.balance_due), 0) },
      over_90: { invoices: over90, total: over90.reduce((s, i) => s + parseFloat(i.balance_due), 0) },
      grand_total: r.rows.reduce((s, i) => s + parseFloat(i.balance_due), 0)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET export CSV
router.get('/export/invoices', async (req, res) => {
  try {
    const { year } = req.query;
    const y = year || new Date().getFullYear();
    const r = await pool.query(
      `SELECT i.invoice_number, i.status, i.created_at, i.due_date, i.subtotal, i.tax_amount, i.total, i.amount_paid, i.balance_due,
              c.name as customer_name
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       WHERE EXTRACT(YEAR FROM i.created_at) = $1
       ORDER BY i.created_at`, [y]);

    let csv = 'Invoice #,Customer,Status,Date,Due Date,Subtotal,Tax,Total,Paid,Balance\n';
    for (const row of r.rows) {
      csv += `"${row.invoice_number}","${row.customer_name}","${row.status}","${row.created_at?.toISOString().split('T')[0]}","${row.due_date}","${row.subtotal}","${row.tax_amount}","${row.total}","${row.amount_paid}","${row.balance_due}"\n`;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=invoices-${y}.csv`);
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
