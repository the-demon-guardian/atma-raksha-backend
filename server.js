require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const db = require("./db/db");
const authRoutes = require("./routes/auth");
const alertRoutes = require("./routes/alerts");
const aiChatRoutes = require("./routes/aiChat");
const voiceRoutes = require("./routes/voice");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Health check - also used by the free uptime-ping service (see README)
// to keep the server awake and prevent it spinning down mid-escalation.
app.get("/", (req, res) => res.json({ success: true, message: "Atma Raksha AI backend is running" }));
app.get("/health", (req, res) => res.json({ success: true, status: "awake" }));

app.use("/auth", authRoutes);
app.use("/", alertRoutes);
app.use("/", aiChatRoutes);
app.use("/voice", voiceRoutes);

const PORT = process.env.PORT || 4000;

db.initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Atma Raksha AI backend running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err.message);
    process.exit(1);
  });
