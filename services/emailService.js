const nodemailer = require("nodemailer");

// Uses Gmail + an App Password (never the main account password).
// EMAIL_USER and EMAIL_APP_PASSWORD are read from environment variables only -
// set them in Render's Environment tab, never in this file or in chat.
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

async function sendEmail(toEmail, subject, message, htmlBody = null) {
  if (!toEmail) return { success: false, error: "No recipient email configured" };
  try {
    await transporter.sendMail({
      from: `"Atma Raksha AI" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject,
      text: message,
      html: htmlBody || undefined, // falls back to plain text if no HTML given
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Builds a styled HTML emergency alert email - a red header banner, a clean
 * info table (Person / Time / Location / Battery / Alert Level), and an
 * activity log section, matching the layout used elsewhere in the app.
 */
function buildAlertEmailHtml({ personName, timeStr, mapsLink, batteryPercent, escalationLevel, activityLog }) {
  const levelLabels = { 0: "Level 0 - Emergency Contact 1", 1: "Level 1 - Emergency Contact 2", 2: "Level 2 - Police Helpline" };
  const locationCell = mapsLink
    ? `<a href="${mapsLink}" style="color:#C62828;">${mapsLink}</a>`
    : "Unavailable";
  const logRows = (activityLog || [])
    .map((line) => `<li style="margin-bottom:6px;">${line}</li>`)
    .join("");

  return `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
    <div style="background:#C62828;color:#fff;padding:20px;border-radius:8px 8px 0 0;">
      <h2 style="margin:0;">🚨 EMERGENCY ALERT — Atma Raksha AI</h2>
    </div>
    <div style="border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
      <p style="font-size:15px;">Someone needs your help immediately:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr style="background:#FCE8E8;"><td style="padding:10px;font-weight:bold;">Person</td><td style="padding:10px;">${personName}</td></tr>
        <tr><td style="padding:10px;font-weight:bold;">Time</td><td style="padding:10px;">${timeStr}</td></tr>
        <tr style="background:#FCE8E8;"><td style="padding:10px;font-weight:bold;">Location</td><td style="padding:10px;">${locationCell}</td></tr>
        <tr><td style="padding:10px;font-weight:bold;">Battery</td><td style="padding:10px;">${batteryPercent ?? "unknown"}%</td></tr>
        <tr style="background:#FCE8E8;"><td style="padding:10px;font-weight:bold;">Alert Level</td><td style="padding:10px;">${levelLabels[escalationLevel] || "Unknown"}</td></tr>
      </table>
      ${logRows ? `<div style="margin-top:16px;"><strong>Activity Log:</strong><ul style="padding-left:18px;font-size:14px;color:#444;">${logRows}</ul></div>` : ""}
      <p style="margin-top:20px;font-size:14px;color:#555;">Please respond immediately or contact local emergency services.</p>
    </div>
  </div>`;
}

/**
 * Send a one-time OTP code by email (since Twilio Verify only covers phone).
 */
async function sendEmailOtp(toEmail, code) {
  return sendEmail(
    toEmail,
    "Your Atma Raksha AI verification code",
    `Your verification code is: ${code}\nThis code expires in 10 minutes. If you did not request this, ignore this email.`
  );
}

module.exports = { sendEmail, sendEmailOtp, buildAlertEmailHtml };
