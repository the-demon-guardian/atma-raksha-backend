const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/db");
const { sendOtp, checkOtp } = require("../services/twilioService");
const { sendEmailOtp } = require("../services/emailService");

const router = express.Router();

// Simple in-memory store for email OTPs: { email: { code, expiresAt } }
// Fine for MVP demo purposes; a production system should persist this.
const emailOtps = new Map();

// ---------- POST /auth/send-email-otp ----------
router.post("/send-email-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: "email is required" });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  emailOtps.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
  const result = await sendEmailOtp(email, code);
  res.json(result);
});

// ---------- POST /auth/verify-email-otp ----------
router.post("/verify-email-otp", (req, res) => {
  const { email, code } = req.body;
  const entry = emailOtps.get(email);
  if (!entry) return res.json({ success: false, error: "No OTP was requested for this email" });
  if (Date.now() > entry.expiresAt) {
    emailOtps.delete(email);
    return res.json({ success: false, error: "OTP expired, request a new one" });
  }
  const success = entry.code === String(code);
  if (success) emailOtps.delete(email);
  res.json({ success });
});

// ---------- POST /auth/send-otp ----------
router.post("/send-otp", async (req, res) => {
  const { mobile } = req.body;
  if (!mobile) return res.status(400).json({ success: false, error: "mobile is required" });
  const result = await sendOtp(mobile);
  res.json(result);
});

// ---------- POST /auth/verify-otp ----------
router.post("/verify-otp", async (req, res) => {
  const { mobile, code } = req.body;
  if (!mobile || !code) return res.status(400).json({ success: false, error: "mobile and code required" });
  const result = await checkOtp(mobile, code);
  res.json(result);
});

// ---------- POST /auth/signup ----------
router.post("/signup", async (req, res) => {
  try {
    const b = req.body;
    if (!b.primary_mobile || !b.password) {
      return res.status(400).json({ success: false, error: "primary_mobile and password are required" });
    }

    const existing = await db.get("SELECT id FROM users WHERE primary_mobile = ?", [b.primary_mobile]);
    if (existing) {
      return res.status(409).json({ success: false, error: "An account with this mobile number already exists" });
    }

    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(b.password, 10);

    let disguiseCodeHash = null;
    if (b.disguise_unlock_type === "code" && b.disguise_unlock_code) {
      disguiseCodeHash = bcrypt.hashSync(String(b.disguise_unlock_code), 10);
    }

    await db.run(
      `INSERT INTO users (
        id, full_name, id_proof_type, id_number, father_name, mother_name, spouse_name,
        dob, height_cm, weight_kg, blood_type, permanent_address, temporary_address,
        primary_mobile, primary_mobile_verified, alt_mobile, alt_mobile_verified,
        email, email_verified, emergency_mobile_1, emergency_mobile_2, emergency_email,
        password_hash, disguise_enabled, disguise_unlock_type, disguise_unlock_code,
        disguise_unlock_operator, checkin_interval_minutes, language, photo_path
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        b.full_name || null,
        b.id_proof_type || null,
        b.id_number || null,
        b.father_name || null,
        b.mother_name || null,
        b.spouse_name || null,
        b.dob || null,
        b.height_cm || null,
        b.weight_kg || null,
        b.blood_type || null,
        b.permanent_address || null,
        b.temporary_address || null,
        b.primary_mobile,
        b.primary_mobile_verified ? 1 : 0,
        b.alt_mobile || null,
        b.alt_mobile_verified ? 1 : 0,
        b.email || null,
        b.email_verified ? 1 : 0,
        b.emergency_mobile_1 || null,
        b.emergency_mobile_2 || null,
        b.emergency_email || null,
        passwordHash,
        b.disguise_enabled ? 1 : 0,
        b.disguise_unlock_type || null,
        disguiseCodeHash,
        b.disguise_unlock_operator || null,
        b.checkin_interval_minutes || 60,
        b.language || "en",
        b.photo_path || null,
      ]
    );

    const token = jwt.sign({ userId: id }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, message: "Congratulations 🎉 your account has been created with Atma Raksha AI", token, userId: id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- POST /auth/login ----------
router.post("/login", async (req, res) => {
  try {
    const { primary_mobile, password } = req.body;
    const user = await db.get("SELECT * FROM users WHERE primary_mobile = ?", [primary_mobile]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: "Invalid mobile number or password" });
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, token, userId: user.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- POST /auth/verify-disguise-unlock ----------
router.post("/verify-disguise-unlock", async (req, res) => {
  try {
    const { userId, type, code, operator } = req.body;
    const user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    if (type === "code" && user.disguise_unlock_type === "code") {
      const ok = bcrypt.compareSync(String(code || ""), user.disguise_unlock_code || "");
      return res.json({ success: ok });
    }
    if (type === "longpress" && user.disguise_unlock_type === "longpress") {
      const ok = operator === user.disguise_unlock_operator;
      return res.json({ success: ok });
    }
    res.json({ success: false });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
            
