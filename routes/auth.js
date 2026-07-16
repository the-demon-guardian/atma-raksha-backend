const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/db");
const { requireAuth } = require("../services/authMiddleware");
const { sendOtp, checkOtp } = require("../services/twilioService");
const { sendEmailOtp } = require("../services/emailService");

const router = express.Router();

// ---------- POST /auth/set-pin ----------
// Sets/changes the 4-digit security PIN used to confirm scheduled check-ins.
// body: { pin: "1234" }
router.post("/set-pin", requireAuth, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(String(pin))) {
      return res.status(400).json({ success: false, error: "PIN must be exactly 4 digits" });
    }
    const pinHash = bcrypt.hashSync(String(pin), 10);
    await db.run("UPDATE users SET security_pin_hash = ? WHERE id = ?", [pinHash, req.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
// NOTE: There is no longer a separate password. The account's login
// credential IS whatever disguise-unlock method is set up here (a 3-digit
// code or a long-press operator) - that same credential unlocks the
// calculator disguise AND logs the user in, in one action. Fingerprint/face
// unlock, if also enabled, is a LOCAL-ONLY convenience layered on top (it
// can never independently restore a session after logout/reinstall, since
// biometric data never leaves the device - the code/long-press remains the
// one recoverable credential).
router.post("/signup", async (req, res) => {
  try {
    const b = req.body;
    if (!b.primary_mobile) {
      return res.status(400).json({ success: false, error: "primary_mobile is required" });
    }
    if (b.disguise_unlock_type !== "code" && b.disguise_unlock_type !== "longpress") {
      return res.status(400).json({ success: false, error: "A 3-digit code or long-press unlock method is required" });
    }
    if (b.disguise_unlock_type === "code" && !b.disguise_unlock_code) {
      return res.status(400).json({ success: false, error: "disguise_unlock_code is required for code unlock" });
    }
    if (b.disguise_unlock_type === "longpress" && !b.disguise_unlock_operator) {
      return res.status(400).json({ success: false, error: "disguise_unlock_operator is required for long-press unlock" });
    }

    const existing = await db.get("SELECT id FROM users WHERE primary_mobile = ?", [b.primary_mobile]);
    if (existing) {
      return res.status(409).json({ success: false, error: "An account with this mobile number already exists" });
    }

    const id = uuidv4();
    // password_hash is kept in the schema for backward compatibility but is
    // no longer collected or required - the disguise-unlock credential is
    // now the sole login mechanism.
    const passwordHash = b.password ? bcrypt.hashSync(b.password, 10) : null;

    let disguiseCodeHash = null;
    if (b.disguise_unlock_type === "code") {
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
        1, // disguise_enabled is always true now - it IS the login mechanism, not optional
        b.disguise_unlock_type,
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
// RETAINED but no longer used by the app - kept harmlessly for backward
// compatibility. Since accounts created via the new flow have no password
// (password_hash is null), this will simply fail for them, which is
// correct and expected.
router.post("/login", async (req, res) => {
  try {
    const { primary_mobile, password } = req.body;
    const user = await db.get("SELECT * FROM users WHERE primary_mobile = ?", [primary_mobile]);
    if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: "Invalid mobile number or password" });
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, token, userId: user.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- POST /auth/verify-disguise-unlock ----------
// This IS the login action now - a successful code/long-press match issues
// a real login token, same as signup does. Fingerprint success is verified
// entirely on-device (see BiometricHelper.kt) and never reaches this
// endpoint at all - it only works while a token is already stored locally.
router.post("/verify-disguise-unlock", async (req, res) => {
  try {
    const { userId, type, code, operator } = req.body;
    const user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    let ok = false;
    if (type === "code" && user.disguise_unlock_type === "code") {
      ok = bcrypt.compareSync(String(code || ""), user.disguise_unlock_code || "");
    } else if (type === "longpress" && user.disguise_unlock_type === "longpress") {
      ok = operator === user.disguise_unlock_operator;
    }

    if (!ok) {
      return res.json({ success: false });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, token, userId: user.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- GET /auth/me ----------
// Returns the logged-in user's own profile, excluding sensitive fields
// (password_hash, security_pin_hash, disguise_unlock_code are never sent).
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await db.get(
      `SELECT id, full_name, primary_mobile, email, emergency_mobile_1, emergency_mobile_2,
              emergency_email, disguise_enabled, checkin_interval_minutes, language, photo_path
       FROM users WHERE id = ?`,
      [req.userId]
    );
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
