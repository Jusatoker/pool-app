require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function setup() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('✅ Database schema applied successfully');
  } catch (err) {
    console.error('❌ Error applying schema:', err.message);
  } finally {
    await pool.end();
  }
}

setup();
