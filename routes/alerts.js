const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/db");
const { requireAuth } = require("../services/authMiddleware");
const { sendSMS, sendWhatsApp, placeEmergencyCall } = require("../services/twilioService");
const { sendEmail } = require("../services/emailService");

const router = express.Router();

// In-memory map of active escalation timers, keyed by alert_id.
// (MVP approach - fine as long as the Node process stays running. If the
//  free host spins the process down mid-escalation, the timer is lost -
//  see README for the free uptime-ping workaround.)
const escalationTimers = new Map();
const ESCALATION_DELAY_MS = 5 * 60 * 1000; // 5 minutes

async function logActivity(alertId, userId, action, detail, success = true) {
  await db.run(
    `INSERT INTO activity_logs (id, alert_id, user_id, action, detail, success) VALUES (?,?,?,?,?,?)`,
    [uuidv4(), alertId, userId, action, detail, success ? 1 : 0]
  );
}

function buildAlertMessage(user, alert) {
  const mapsLink =
    alert.latitude && alert.longitude
      ? `https://maps.google.com/?q=${alert.latitude},${alert.longitude}`
      : "location unavailable";
  return (
    `🚨 EMERGENCY ALERT — ${user.full_name || "Atma Raksha AI user"}\n` +
    `Live location: ${mapsLink}\n` +
    `Battery: ${alert.battery_percent ?? "unknown"}%\n` +
    `Please respond immediately or contact local emergency services.`
  );
}

async function withRetry(fn, maxAttempts = 3, delayMs = 3000) {
  let lastResult = { success: false, error: "not attempted" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await fn();
    if (lastResult.success) return { ...lastResult, attempts: attempt };
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ...lastResult, attempts: maxAttempts };
}

async function notifyLevel(alert, user, level) {
  const publicServerUrl = process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 4000}`;
  let targetNumber = null;

  if (level === 0) targetNumber = user.emergency_mobile_1;
  else if (level === 1) targetNumber = user.emergency_mobile_2;
  else if (level === 2) targetNumber = process.env.POLICE_HELPLINE_NUMBER;

  if (!targetNumber) {
    await logActivity(alert.id, user.id, "escalation_skipped", `No number configured for level ${level}`, false);
    return;
  }

  const message = buildAlertMessage(user, alert);

  const smsResult = await withRetry(() => sendSMS(targetNumber, message));
  await logActivity(alert.id, user.id, "sms_sent", `to ${targetNumber} (attempts: ${smsResult.attempts}): ${smsResult.success ? "ok" : smsResult.error}`, smsResult.success);

  const waResult = await withRetry(() => sendWhatsApp(targetNumber, message));
  await logActivity(alert.id, user.id, "whatsapp_sent", `to ${targetNumber} (attempts: ${waResult.attempts}): ${waResult.success ? "ok" : waResult.error}`, waResult.success);

  const callResult = await withRetry(() => placeEmergencyCall(targetNumber, publicServerUrl, message));
  await logActivity(alert.id, user.id, "call_placed", `to ${targetNumber} (attempts: ${callResult.attempts}): ${callResult.success ? "ok" : callResult.error}`, callResult.success);

  if (user.emergency_email) {
    const emailResult = await withRetry(() => sendEmail(user.emergency_email, "🚨 Emergency Alert - Atma Raksha AI", message));
    await logActivity(alert.id, user.id, "email_sent", `to ${user.emergency_email} (attempts: ${emailResult.attempts}): ${emailResult.success ? "ok" : emailResult.error}`, emailResult.success);
  }
}

function scheduleEscalationCheck(alertId) {
  const timer = setTimeout(async () => {
    const alert = await db.get("SELECT * FROM alerts WHERE id = ?", [alertId]);
    if (!alert || alert.status !== "Emergency") return; // was marked safe - stop

    const nextLevel = alert.escalation_level + 1;
    const user = await db.get("SELECT * FROM users WHERE id = ?", [alert.user_id]);

    await db.run("UPDATE alerts SET escalation_level = ?, updated_at = datetime('now') WHERE id = ?", [nextLevel, alertId]);
    await logActivity(alertId, alert.user_id, "escalated", `to level ${nextLevel}`);

    await notifyLevel({ ...alert, escalation_level: nextLevel }, user, nextLevel);

    if (nextLevel < 2) {
      scheduleEscalationCheck(alertId);
    }
  }, ESCALATION_DELAY_MS);

  escalationTimers.set(alertId, timer);
}

function clearEscalation(alertId) {
  const timer = escalationTimers.get(alertId);
  if (timer) {
    clearTimeout(timer);
    escalationTimers.delete(alertId);
  }
}

// ---------- POST /trigger-alert ----------
router.post("/trigger-alert", requireAuth, async (req, res) => {
  try {
    const { latitude, longitude, battery_percent, connectivity_status, nearby_signals, audio_ref, video_ref } = req.body;
    const user = await db.get("SELECT * FROM users WHERE id = ?", [req.userId]);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const id = uuidv4();
    await db.run(
      `INSERT INTO alerts (id, user_id, status, escalation_level, latitude, longitude, battery_percent, connectivity_status, nearby_signals_json, audio_ref, video_ref)
       VALUES (?, ?, 'Emergency', 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, user.id, latitude || null, longitude || null, battery_percent || null,
        connectivity_status || null, nearby_signals ? JSON.stringify(nearby_signals) : null,
        audio_ref || null, video_ref || null,
      ]
    );

    const alert = await db.get("SELECT * FROM alerts WHERE id = ?", [id]);
    await logActivity(id, user.id, "alert_triggered", "Level 0 - notifying Emergency Contact 1");

    await notifyLevel(alert, user, 0);
    scheduleEscalationCheck(id);

    res.json({ success: true, alertId: id, status: "Emergency", escalationLevel: 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- POST /mark-safe ----------
router.post("/mark-safe", requireAuth, async (req, res) => {
  try {
    const { alertId } = req.body;
    const alert = await db.get("SELECT * FROM alerts WHERE id = ? AND user_id = ?", [alertId, req.userId]);
    if (!alert) return res.status(404).json({ success: false, error: "Alert not found" });

    await db.run("UPDATE alerts SET status = 'Normal', updated_at = datetime('now') WHERE id = ?", [alertId]);
    clearEscalation(alertId);
    await logActivity(alertId, req.userId, "marked_safe", "User marked themselves safe - escalation stopped");

    res.json({ success: true, status: "Normal" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- GET /alert-status?alertId=... ----------
router.get("/alert-status", requireAuth, async (req, res) => {
  try {
    const { alertId } = req.query;
    const alert = await db.get("SELECT * FROM alerts WHERE id = ? AND user_id = ?", [alertId, req.userId]);
    if (!alert) return res.status(404).json({ success: false, error: "Alert not found" });
    res.json({ success: true, alert });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- GET /alert-history ----------
router.get("/alert-history", requireAuth, async (req, res) => {
  try {
    const alerts = await db.all("SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC", [req.userId]);
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- POST /checkin ----------
router.post("/checkin", requireAuth, async (req, res) => {
  try {
    await db.run("INSERT INTO checkins (id, user_id) VALUES (?, ?)", [uuidv4(), req.userId]);
    res.json({ success: true, checkedInAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
