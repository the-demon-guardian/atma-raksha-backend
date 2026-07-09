const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

const client = twilio(accountSid, authToken);

/**
 * Send an SMS. Returns { success, sid|error }
 */
async function sendSMS(toNumber, message) {
  try {
    const msg = await client.messages.create({
      body: message,
      from: fromNumber,
      to: toNumber,
    });
    return { success: true, sid: msg.sid };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Place an automated voice call that reads out a short emergency message.
 * Uses Twilio's <Say> TwiML via a simple inline TwiML Bin URL alternative:
 * we generate TwiML on the fly using the `twiml` param (Twilio supports
 * a `twiml` URL-encoded string directly on some accounts; the safest
 * portable approach is to host a tiny TwiML endpoint - see /voice/twiml
 * route in routes/voice.js which this call points to).
 */
async function placeEmergencyCall(toNumber, publicServerUrl, spokenMessageParam) {
  try {
    const call = await client.calls.create({
      from: fromNumber,
      to: toNumber,
      url: `${publicServerUrl}/voice/twiml?msg=${encodeURIComponent(spokenMessageParam)}`,
    });
    return { success: true, sid: call.sid };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Real phone OTP using Twilio Verify (SMS-based).
 */
async function sendOtp(toNumber) {
  try {
    const res = await client.verify.v2
      .services(verifyServiceSid)
      .verifications.create({ to: toNumber, channel: "sms" });
    return { success: true, status: res.status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function checkOtp(toNumber, code) {
  try {
    const res = await client.verify.v2
      .services(verifyServiceSid)
      .verificationChecks.create({ to: toNumber, code });
    return { success: res.status === "approved", status: res.status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Send a WhatsApp message via Twilio's WhatsApp API.
 * NOTE: Requires a WhatsApp-enabled Twilio sender. On a free/trial Twilio
 * account this means the Twilio WhatsApp Sandbox - the recipient must first
 * send "join <sandbox-code>" to the Twilio sandbox number once, from their
 * own WhatsApp, before they can receive messages. Fine for demo/testing;
 * a production number needs WhatsApp Business API approval from Twilio/Meta.
 */
async function sendWhatsApp(toNumber, message) {
  try {
    const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || `whatsapp:${fromNumber}`;
    const msg = await client.messages.create({
      body: message,
      from: fromWhatsApp,
      to: `whatsapp:${toNumber}`,
    });
    return { success: true, sid: msg.sid };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { sendSMS, sendWhatsApp, placeEmergencyCall, sendOtp, checkOtp };
