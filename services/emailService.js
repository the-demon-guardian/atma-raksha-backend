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

async function sendEmail(toEmail, subject, message) {
  if (!toEmail) return { success: false, error: "No recipient email configured" };
  try {
    await transporter.sendMail({
      from: `"Atma Raksha AI" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject,
      text: message,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
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

module.exports = { sendEmail, sendEmailOtp };
