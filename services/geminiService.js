const fetch = require("node-fetch");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

/**
 * Send a chat message to Gemini and return the text reply.
 * history: array of { role: 'user'|'model', text: string }  (optional, for context)
 */
async function chatWithGemini(userMessage, history = []) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const contents = [
    ...history.map((h) => ({
      role: h.role === "model" ? "model" : "user",
      parts: [{ text: h.text }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const body = {
    contents,
    systemInstruction: {
      parts: [
        {
          text:
            "You are the in-app assistant for Atma Raksha AI, a personal safety app. " +
            "Be calm, supportive, and practical. If the user describes an active emergency, " +
            "clearly tell them to use the app's Emergency button and, if possible, call local " +
            "emergency services directly, in addition to anything else you say.",
        },
      ],
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      "Sorry, I couldn't generate a response right now.";
    return { success: true, reply };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { chatWithGemini };
