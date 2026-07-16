require("dotenv").config();
const { createClient } = require("@libsql/client");

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function run(sql, args = []) {
  return client.execute({ sql, args });
}

async function get(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows[0] || null;
}

async function all(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows;
}

async function initSchema() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT,
      id_proof_type TEXT,
      id_number TEXT,
      father_name TEXT,
      mother_name TEXT,
      spouse_name TEXT,
      dob TEXT,
      height_cm REAL,
      weight_kg REAL,
      blood_type TEXT,
      permanent_address TEXT,
      temporary_address TEXT,
      primary_mobile TEXT UNIQUE,
      primary_mobile_verified INTEGER DEFAULT 0,
      alt_mobile TEXT,
      alt_mobile_verified INTEGER DEFAULT 0,
      email TEXT,
      email_verified INTEGER DEFAULT 0,
      emergency_mobile_1 TEXT,
      emergency_mobile_2 TEXT,
      emergency_email TEXT,
      password_hash TEXT,
      disguise_enabled INTEGER DEFAULT 0,
      disguise_unlock_type TEXT,
      disguise_unlock_code TEXT,
      disguise_unlock_operator TEXT,
      checkin_interval_minutes INTEGER DEFAULT 60,
      security_pin_hash TEXT,
      language TEXT DEFAULT 'en',
      photo_path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT DEFAULT 'Normal',
      escalation_level INTEGER DEFAULT 0,
      latitude REAL,
      longitude REAL,
      battery_percent INTEGER,
      connectivity_status TEXT,
      nearby_signals_json TEXT,
      audio_ref TEXT,
      video_ref TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      alert_id TEXT,
      user_id TEXT,
      action TEXT,
      detail TEXT,
      success INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS checkins (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      checked_in_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { client, run, get, all, initSchema };
