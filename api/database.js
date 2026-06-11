const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PGHOST || 'db',
  user: process.env.PGUSER || 'erpura_user',
  password: process.env.PGPASSWORD || 'erpura_pass',
  database: process.env.PGDATABASE || 'erpura_db',
  port: parseInt(process.env.PGPORT || '5432'),
});

async function initDb() {
  const client = await pool.connect();
  try {
    // Create Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        lark_id VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100),
        avatar TEXT,
        role VARCHAR(20) DEFAULT 'Viewer'
      );
    `);

    // Create Audit Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id INT,
        user_name VARCHAR(100),
        action VARCHAR(100) NOT NULL,
        details TEXT
      );
    `);

    // Create Comments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        issue_id VARCHAR(100) NOT NULL,
        user_id INT,
        user_name VARCHAR(100),
        user_avatar TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        comment_text TEXT NOT NULL
      );
    `);

    console.log('PostgreSQL Database tables verified/created successfully.');
  } catch (err) {
    console.error('Error initializing database tables:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDb
};
