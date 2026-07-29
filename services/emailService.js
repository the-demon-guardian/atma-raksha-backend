// EMAIL SERVICE - Brevo HTTP API (NOT SMTP/nodemailer)
//
// WHY THIS CHANGED: Render blocks outbound SMTP traffic (ports 25/465/587)
// on free-tier web services, as of September 26, 2025 - this is a Render
// platform policy, not a bug in this code. Nodemailer + Gmail SMTP simply
// cannot work on Render's free tier at all, regardless of how correctly
// it's configured. Brevo sends email over regular HTTPS (port 443), which
// is never blocked, so this is the actual fix rather than a workaround.
//
// Setup required: a free Brevo account (brevo.com), a verified sender
// email, and an API key - see BREVO_API_KEY in .env.example.

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL; // must be verified in Brevo
const BREVO_SENDER_NAME = "Atma Raksha AI";

async function sendEmail(toEmail, subject, message, htmlBody = null) {
  if (!toEmail) return { success: false, error: "No recipient email configured" };
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
    return { success: false, error: "BREVO_API_KEY or BREVO_SENDER_EMAIL not configured" };
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
        to: [{ email: toEmail }],
        subject,
        textContent: message,
        htmlContent: htmlBody || `<pre>${message}</pre>`,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { success: false, error: `Brevo API error (${res.status}): ${errBody}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Builds a styled HTML emergency alert email - a red header banner, a clean
 * info table (Person / Time / Location / Battery / Alert Level), and an
 * activity log section.
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
