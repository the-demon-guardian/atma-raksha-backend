const fetch = require("node-fetch");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

/**
 * Send a chat message to Gemini and return the text reply.
 * history: array of { role: 'user'|'model', text: string }  (optional, for context)
 * imageBase64 / imageMimeType: optional - attaches a photo to THIS message only
 * (Gemini's multimodal input, sent as inline base64 data - fine for a single
 * photo per message; NOT used for video/large files, which need a separate,
 * heavier upload flow this MVP does not implement).
 */
async function chatWithGemini(userMessage, history = [], imageBase64 = null, imageMimeType = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const userParts = [{ text: userMessage || "(Image attached, no caption)" }];
  if (imageBase64 && imageMimeType) {
    userParts.push({
      inline_data: {
        mime_type: imageMimeType,
        data: imageBase64,
      },
    });
  }

  const contents = [
    ...history.map((h) => ({
      role: h.role === "model" ? "model" : "user",
      parts: [{ text: h.text }],
    })),
    { role: "user", parts: userParts },
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
