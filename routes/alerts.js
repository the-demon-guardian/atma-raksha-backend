const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/db");
const { requireAuth } = require("../services/authMiddleware");
const { sendSMS, sendWhatsApp, placeEmergencyCall } = require("../services/twilioService");
const { sendEmail, buildAlertEmailHtml } = require("../services/emailService");

const router = express.Router();

const escalationTimers = new Map();
const ESCALATION_DELAY_MS = 5 * 60 * 1000; // 5 minutes

async function logActivity(alertId, userId, action, detail, success = true) {
  await db.run(
    `INSERT INTO activity_logs (id, alert_id, user_id, action, detail, success) VALUES (?,?,?,?,?,?)`,
    [uuidv4(), alertId, userId, action, detail, success ? 1 : 0]
  );
}

function buildAlertMessage(user, alert) {
  const publicServerUrl = process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 4000}`;
  const liveLink = `${publicServerUrl}/live-location/${alert.id}`;
  return (
    `🚨 EMERGENCY ALERT — ${user.full_name || "Atma Raksha AI user"}\n` +
    `Live location (updates automatically): ${liveLink}\n` +
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

async function getActivityLogSummary(alertId) {
  const rows = await db.all(
    "SELECT action, detail, created_at FROM activity_logs WHERE alert_id = ? ORDER BY created_at ASC",
    [alertId]
  );
  return rows.map((r) => `[${r.created_at}] ${r.action}: ${r.detail}`);
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
    const liveLink = `${publicServerUrl}/live-location/${alert.id}`;
    const activityLog = await getActivityLogSummary(alert.id);
    const html = buildAlertEmailHtml({
      personName: user.full_name || "Atma Raksha AI user",
      timeStr: new Date().toLocaleString(),
      mapsLink: liveLink,
      batteryPercent: alert.battery_percent,
      escalationLevel: level,
      activityLog,
    });
    const emailResult = await withRetry(() => sendEmail(user.emergency_email, "🚨 Emergency Alert - Atma Raksha AI", message, html));
    await logActivity(alert.id, user.id, "email_sent", `to ${user.emergency_email} (attempts: ${emailResult.attempts}): ${emailResult.success ? "ok" : emailResult.error}`, emailResult.success);
  }
}

function scheduleEscalationCheck(alertId) {
  const timer = setTimeout(async () => {
    const alert = await db.get("SELECT * FROM alerts WHERE id = ?", [alertId]);
    if (!alert || alert.status !== "Emergency") return;

    const nextLevel = alert.escalation_level + 1;
    const user = await db.get("SELECT * FROM users WHERE id = ?", [alert.user_id]);

    await db.run("UPDATE alerts SET escalation_level = ?, updated_at = datetime('now') WHERE id = ?", [nextLevel, alertId]);
    await logActivity(alertId, alert.user_id, "escalated", `to level ${nextLevel}`);

    await notifyLevel({ ...alert, escalation_level: nextLevel }, user, nextLevel);

    if (nextLevel < 2) scheduleEscalationCheck(alertId);
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

router.get("/active-alert", requireAuth, async (req, res) => {
  try {
    const alert = await db.get(
      "SELECT * FROM alerts WHERE user_id = ? AND status = 'Emergency' ORDER BY created_at DESC LIMIT 1",
      [req.userId]
    );
    if (!alert) return res.json({ success: true, alert: null });

    let nextEscalationAt = null;
    if (alert.escalation_level < 2) {
      const updatedAtMs = new Date(alert.updated_at + "Z").getTime();
      nextEscalationAt = new Date(updatedAtMs + ESCALATION_DELAY_MS).toISOString();
    }
    const activityLog = await getActivityLogSummary(alert.id);
    res.json({ success: true, alert, nextEscalationAt, activityLog });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/trigger-alert", requireAuth, async (req, res) => {
  try {
    const { latitude, longitude, battery_percent, connectivity_status, nearby_signals, audio_ref, video_ref } = req.body;
    const user = await db.get("SELECT * FROM users WHERE id = ?", [req.userId]);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const existing = await db.get(
      "SELECT * FROM alerts WHERE user_id = ? AND status = 'Emergency' LIMIT 1",
      [req.userId]
    );
    if (existing) {
      let nextEscalationAt = null;
      if (existing.escalation_level < 2) {
        const updatedAtMs = new Date(existing.updated_at + "Z").getTime();
        nextEscalationAt = new Date(updatedAtMs + ESCALATION_DELAY_MS).toISOString();
      }
      return res.json({
        success: true, alertId: existing.id, status: "Emergency",
        escalationLevel: existing.escalation_level, nextEscalationAt,
        note: "An emergency was already active - re-using it instead of creating a duplicate.",
      });
    }

    const id = uuidv4();
    await db.run(
      `INSERT INTO alerts (id, user_id, status, escalation_level, latitude, longitude, battery_percent, connectivity_status, nearby_signals_json, audio_ref, video_ref)
       VALUES (?, ?, 'Emergency', 0, ?, ?, ?, ?, ?, ?, ?)`,
      [id, user.id, latitude || null, longitude || null, battery_percent || null,
        connectivity_status || null, nearby_signals ? JSON.stringify(nearby_signals) : null,
        audio_ref || null, video_ref || null]
    );

    const alert = await db.get("SELECT * FROM alerts WHERE id = ?", [id]);
    await logActivity(id, user.id, "alert_triggered", "Level 0 - notifying Emergency Contact 1");

    await notifyLevel(alert, user, 0);
    scheduleEscalationCheck(id);

    const nextEscalationAt = new Date(Date.now() + ESCALATION_DELAY_MS).toISOString();
    res.json({ success: true, alertId: id, status: "Emergency", escalationLevel: 0, nextEscalationAt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/mark-safe", requireAuth, async (req, res) => {
  try {
    const { alertId } = req.body;

    let alertsToCancel = [];
    if (alertId) {
      const alert = await db.get("SELECT * FROM alerts WHERE id = ? AND user_id = ?", [alertId, req.userId]);
      if (!alert) return res.status(404).json({ success: false, error: "Alert not found" });
      alertsToCancel = [alert];
    } else {
      alertsToCancel = await db.all("SELECT * FROM alerts WHERE user_id = ? AND status = 'Emergency'", [req.userId]);
    }

    if (alertsToCancel.length === 0) {
      return res.json({ success: true, status: "Normal", cancelledCount: 0 });
    }

    for (const alert of alertsToCancel) {
      await db.run("UPDATE alerts SET status = 'Normal', updated_at = datetime('now') WHERE id = ?", [alert.id]);
      clearEscalation(alert.id);
      await logActivity(alert.id, req.userId, "marked_safe", "User marked themselves safe - escalation stopped");
    }

    res.json({ success: true, status: "Normal", cancelledCount: alertsToCancel.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/alert-status", requireAuth, async (req, res) => {
  try {
    const { alertId } = req.query;
    const alert = await db.get("SELECT * FROM alerts WHERE id = ? AND user_id = ?", [alertId, req.userId]);
    if (!alert) return res.status(404).json({ success: false, error: "Alert not found" });

    let nextEscalationAt = null;
    if (alert.status === "Emergency" && alert.escalation_level < 2) {
      const updatedAtMs = new Date(alert.updated_at + "Z").getTime();
      nextEscalationAt = new Date(updatedAtMs + ESCALATION_DELAY_MS).toISOString();
    }
    const activityLog = await getActivityLogSummary(alertId);
    res.json({ success: true, alert, nextEscalationAt, activityLog });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/alert-history", requireAuth, async (req, res) => {
  try {
    const alerts = await db.all("SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC", [req.userId]);
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/checkin", requireAuth, async (req, res) => {
  try {
    const { pin } = req.body;
    const user = await db.get("SELECT security_pin_hash FROM users WHERE id = ?", [req.userId]);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    if (user.security_pin_hash) {
      if (!pin) return res.status(400).json({ success: false, error: "PIN required to confirm check-in" });
      const valid = bcrypt.compareSync(String(pin), user.security_pin_hash);
      if (!valid) return res.status(401).json({ success: false, error: "Incorrect PIN" });
    }

    await db.run("INSERT INTO checkins (id, user_id) VALUES (?, ?)", [uuidv4(), req.userId]);
    res.json({ success: true, checkedInAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/update-location", requireAuth, async (req, res) => {
  try {
    const { alertId, latitude, longitude } = req.body;
    if (!alertId || latitude == null || longitude == null) {
      return res.status(400).json({ success: false, error: "alertId, latitude, longitude are required" });
    }
    const alert = await db.get("SELECT * FROM alerts WHERE id = ? AND user_id = ?", [alertId, req.userId]);
    if (!alert) return res.status(404).json({ success: false, error: "Alert not found" });
    if (alert.status !== "Emergency") return res.status(400).json({ success: false, error: "Alert is not active" });

    await db.run("UPDATE alerts SET latitude = ?, longitude = ?, updated_at = datetime('now') WHERE id = ?", [latitude, longitude, alertId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/live-location-data/:alertId", async (req, res) => {
  try {
    const alert = await db.get(
      "SELECT latitude, longitude, status, battery_percent, updated_at FROM alerts WHERE id = ?",
      [req.params.alertId]
    );
    if (!alert) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, ...alert });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/live-location/:alertId", (req, res) => {
  const alertId = req.params.alertId;
  res.set("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Atma Raksha AI — Live Location</title>
<style>body{font-family:Arial,sans-serif;margin:0;padding:0;background:#f5f5f5;}
#banner{background:#C62828;color:#fff;padding:14px 16px;font-size:16px;}
#status{padding:12px 16px;font-size:14px;color:#444;background:#fff;border-bottom:1px solid #eee;}
#map{width:100%;height:80vh;border:0;}</style></head>
<body>
<div id="banner">🚨 Live location — updates automatically every 10 seconds</div>
<div id="status">Loading…</div>
<iframe id="map"></iframe>
<script>
const alertId = ${JSON.stringify(alertId)};
async function refresh() {
  try {
    const res = await fetch('/live-location-data/' + alertId);
    const data = await res.json();
    if (!data.success) { document.getElementById('status').textContent = 'This link is no longer valid.'; return; }
    const statusEl = document.getElementById('status');
    if (data.latitude && data.longitude) {
      statusEl.textContent = 'Status: ' + data.status + ' — Battery: ' + (data.battery_percent ?? '?') + '% — Last updated: ' + new Date(data.updated_at + 'Z').toLocaleTimeString();
      document.getElementById('map').src = 'https://maps.google.com/maps?q=' + data.latitude + ',' + data.longitude + '&z=16&output=embed';
    } else { statusEl.textContent = 'Waiting for location data…'; }
    if (data.status === 'Normal') { statusEl.textContent += ' (Marked safe — no longer an active emergency)'; }
  } catch (e) { document.getElementById('status').textContent = 'Connection error, retrying…'; }
}
refresh();
setInterval(refresh, 10000);
</script>
</body></html>`);
});

module.exports = router;
