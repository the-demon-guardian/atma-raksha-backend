const express = require("express");
const router = express.Router();

// ---------- GET /voice/twiml ----------
// Twilio calls this URL when placing the automated emergency call, and
// reads back whatever TwiML (Twilio's call-control XML) we return here.
// No auth on this route - Twilio itself must be able to reach it publicly.
router.get("/twiml", (req, res) => {
  const msg = req.query.msg || "This is an emergency alert from Atma Raksha AI. Please check the SMS you just received for the live location.";
  res.set("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-IN">${escapeXml(msg)}</Say>
  <Pause length="1"/>
  <Say voice="alice" language="en-IN">Repeating the message.</Say>
  <Say voice="alice" language="en-IN">${escapeXml(msg)}</Say>
</Response>`);
});

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports = router;
