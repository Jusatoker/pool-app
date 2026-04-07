const express = require('express');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'equipment');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// GET all equipment for a customer
router.get('/customer/:cid', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM equipment WHERE customer_id = $1 ORDER BY equipment_type', [req.params.cid]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single equipment with photos
router.get('/:id', async (req, res) => {
  try {
    const e = await pool.query('SELECT * FROM equipment WHERE id = $1', [req.params.id]);
    if (!e.rows[0]) return res.status(404).json({ error: 'Not found' });
    const photos = await pool.query('SELECT * FROM equipment_photos WHERE equipment_id = $1 ORDER BY uploaded_at DESC', [req.params.id]);
    res.json({ ...e.rows[0], photos: photos.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create equipment
router.post('/', async (req, res) => {
  try {
    const { customer_id, pool_id, equipment_type, manufacturer, model_number, serial_number, specs, install_date, warranty_expiry, condition, notes } = req.body;
    const r = await pool.query(
      `INSERT INTO equipment (customer_id, pool_id, equipment_type, manufacturer, model_number, serial_number, specs, install_date, warranty_expiry, condition, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [customer_id, pool_id, equipment_type, manufacturer, model_number, serial_number, specs || '{}', install_date, warranty_expiry, condition, notes]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update equipment
router.put('/:id', async (req, res) => {
  try {
    const { equipment_type, manufacturer, model_number, serial_number, specs, install_date, warranty_expiry, condition, notes } = req.body;
    const r = await pool.query(
      `UPDATE equipment SET equipment_type=$1, manufacturer=$2, model_number=$3, serial_number=$4, specs=$5, install_date=$6, warranty_expiry=$7, condition=$8, notes=$9 WHERE id=$10 RETURNING *`,
      [equipment_type, manufacturer, model_number, serial_number, specs || '{}', install_date, warranty_expiry, condition, notes, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE equipment
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM equipment WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST upload equipment photo + AI scan
router.post('/:id/photos', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = '/uploads/equipment/' + req.file.filename;
    const caption = req.body.caption || '';

    // Try AI scan of equipment tag
    let aiData = {};
    try {
      const apiKeyR = await pool.query("SELECT value FROM app_settings WHERE key = 'anthropic_api_key'");
      const apiKey = process.env.ANTHROPIC_API_KEY || apiKeyR.rows[0]?.value;
      if (apiKey) {
        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });
        const imgBuffer = fs.readFileSync(req.file.path);
        const base64 = imgBuffer.toString('base64');
        const mimeType = req.file.mimetype || 'image/jpeg';

        const response = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
              { type: 'text', text: `You are analyzing a photo of pool/spa equipment — likely a nameplate, sticker, or label on a pump, filter, heater, chlorinator, or other pool equipment.

Extract ALL visible information and return ONLY a JSON object with these fields (use null if not visible):
{
  "manufacturer": "brand name",
  "model_number": "model/part number",
  "serial_number": "serial number",
  "equipment_type": "pump/filter/heater/chlorinator/automation/cleaner/other",
  "voltage": "voltage rating",
  "amperage": "amp rating",
  "horsepower": "HP rating",
  "gpm": "flow rate",
  "btu": "BTU rating (heaters)",
  "filter_sqft": "filter area",
  "phase": "single/three phase",
  "rpm": "RPM",
  "manufacture_date": "date if visible",
  "additional_specs": "any other visible specs as a string"
}

Return ONLY the JSON, no other text.` }
            ]
          }]
        });

        const text = response.content[0].text.trim();
        // Try to parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiData = JSON.parse(jsonMatch[0]);
        }
      }
    } catch (aiErr) {
      console.log('AI scan failed (non-fatal):', aiErr.message);
    }

    // Save photo record
    const r = await pool.query(
      `INSERT INTO equipment_photos (equipment_id, file_path, caption, ai_extracted_data) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, filePath, caption, JSON.stringify(aiData)]
    );

    // Auto-update equipment fields from AI data if they were empty
    if (Object.keys(aiData).length > 0) {
      const equip = await pool.query('SELECT * FROM equipment WHERE id = $1', [req.params.id]);
      const e = equip.rows[0];
      const updates = {};
      if (!e.manufacturer && aiData.manufacturer) updates.manufacturer = aiData.manufacturer;
      if (!e.model_number && aiData.model_number) updates.model_number = aiData.model_number;
      if (!e.serial_number && aiData.serial_number) updates.serial_number = aiData.serial_number;
      if (aiData.equipment_type && e.equipment_type === 'other') updates.equipment_type = aiData.equipment_type;

      // Build specs from AI
      const specs = e.specs || {};
      ['voltage', 'amperage', 'horsepower', 'gpm', 'btu', 'filter_sqft', 'phase', 'rpm', 'manufacture_date', 'additional_specs'].forEach(k => {
        if (aiData[k]) specs[k] = aiData[k];
      });
      updates.specs = JSON.stringify(specs);

      if (Object.keys(updates).length > 0) {
        const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
        const vals = Object.values(updates);
        vals.push(req.params.id);
        await pool.query(`UPDATE equipment SET ${setClauses} WHERE id = $${vals.length}`, vals);
      }
    }

    res.json({ photo: r.rows[0], ai_data: aiData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
