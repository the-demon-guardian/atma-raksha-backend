const express = require("express");
const { requireAuth } = require("../services/authMiddleware");
const { chatWithGemini } = require("../services/geminiService");

const router = express.Router();

// ---------- POST /ai-chat ----------
// body: { message: "...", history?: [{role, text}, ...], imageBase64?: "...", imageMimeType?: "image/jpeg" }
// A message needs EITHER text OR an image (or both) - not neither.
router.post("/ai-chat", requireAuth, async (req, res) => {
  const { message, history, imageBase64, imageMimeType } = req.body;
  if (!message && !imageBase64) {
    return res.status(400).json({ success: false, error: "message or imageBase64 is required" });
  }

  const result = await chatWithGemini(message || "", history || [], imageBase64 || null, imageMimeType || null);
  res.json(result);
});

module.exports = router;
