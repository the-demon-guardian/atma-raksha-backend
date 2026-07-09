const express = require("express");
const { requireAuth } = require("../services/authMiddleware");
const { chatWithGemini } = require("../services/geminiService");

const router = express.Router();

// ---------- POST /ai-chat ----------
// body: { message: "...", history?: [{role, text}, ...] }
router.post("/ai-chat", requireAuth, async (req, res) => {
  const { message, history } = req.body;
  if (!message) return res.status(400).json({ success: false, error: "message is required" });

  const result = await chatWithGemini(message, history || []);
  res.json(result);
});

module.exports = router;
