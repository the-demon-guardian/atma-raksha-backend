Atma Raksha AI — Backend (MVP)
What this is
A Node.js/Express backend implementing:
Signup / login (JWT-based auth)
Real phone OTP via Twilio Verify
Disguised-calculator unlock verification (code or long-press)
/trigger-alert, /mark-safe, /alert-status, /alert-history, /checkin
Multi-tier escalation: Contact 1 → (5 min silence) → Contact 2 → (5 min silence) → Police helpline
SMS + WhatsApp + automated voice call via Twilio on every escalation tier, each with automatic retry
/ai-chat — Gemini-powered chat, key stays server-side only
Turso (free, persistent, SQLite-compatible cloud DB) — chosen instead of a local file because free hosts like Render wipe local disk on every restart
Deployment: 100% free, no card required
Step 1 — Rotate your keys first
Do this before anything else (see earlier chat warning): rotate the Twilio Auth Token and the Gemini API key. Never reuse ones that were pasted anywhere before.
Step 2 — Create a free Turso database
Go to turso.tech, sign up free (no card).
Create a database (any name, e.g. atma-raksha-ai).
Open its "Connect" tab — copy the TURSO_DATABASE_URL (starts with libsql://...) and generate/copy an auth token.
Step 3 — Create a free Twilio Verify Service (for OTP)
In Twilio Console → Verify → Services → Create new service. Copy its Service SID.
Step 4 — Push this code to a GitHub repo
Create a new GitHub repo, push this backend folder to it (your friend can do this from Android Studio's terminal or GitHub Desktop — doesn't need to be fancy).
Step 5 — Deploy on Render (free)
Go to render.com, sign up free (no card), "New" → "Web Service".
Connect your GitHub repo.
Runtime: Node. Build command: npm install. Start command: npm start.
Instance type: Free.
Under "Environment", add every variable from .env.example with your real (rotated) values. For PUBLIC_SERVER_URL, leave it blank for the first deploy — Render will give you a URL like https://atma-raksha-ai.onrender.com after deploying; come back and add that as PUBLIC_SERVER_URL, then redeploy.
Click "Create Web Service." Wait for the build to finish.
Step 6 — Keep it awake (free workaround for Render's 15-min sleep)
Render's free tier sleeps after 15 minutes with no traffic, which would kill an in-progress escalation. Fix, for free:
Go to cron-job.org, sign up free.
Create a job that GETs https://your-app-name.onrender.com/health every 10 minutes.
This keeps the server awake continuously. (Not officially "supported" by Render, but it's the standard free-tier trick and is fine for a demo/pilot.)
Step 7 — Point the Android app at your backend
Once deployed, your backend's base URL is https://your-app-name.onrender.com. Use that as the BASE_URL in the Android app's networking code (given in the next part of this build).
Testing it manually
# 1. Send OTP
curl -X POST https://your-app-name.onrender.com/auth/send-otp -H "Content-Type: application/json" -d '{"mobile":"+91XXXXXXXXXX"}'

# 2. Verify OTP
curl -X POST https://your-app-name.onrender.com/auth/verify-otp -H "Content-Type: application/json" -d '{"mobile":"+91XXXXXXXXXX","code":"123456"}'

# 3. Sign up
curl -X POST https://your-app-name.onrender.com/auth/signup -H "Content-Type: application/json" -d '{
  "full_name":"Test User","primary_mobile":"+91XXXXXXXXXX","password":"test1234",
  "emergency_mobile_1":"+91YYYYYYYYYY","emergency_mobile_2":"+91ZZZZZZZZZZ"
}'
# -> copy the "token" from the response

# 4. Trigger an alert (replace TOKEN)
curl -X POST https://your-app-name.onrender.com/trigger-alert -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" -d '{"latitude":19.076,"longitude":72.877,"battery_percent":76,"connectivity_status":"wifi"}'

# 5. Mark safe (replace TOKEN and ALERT_ID from step 4's response)
curl -X POST https://your-app-name.onrender.com/mark-safe -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" -d '{"alertId":"ALERT_ID"}'

# 6. AI chat
curl -X POST https://your-app-name.onrender.com/ai-chat -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" -d '{"message":"I feel unsafe walking home, any tips?"}'
Known MVP limitations (by design, not bugs)
Email alerts and email OTP ARE now implemented via Gmail + App Password (nodemailer). WhatsApp uses Twilio's Sandbox on a free account — each recipient must send "join " once to Twilio's sandbox number from their own WhatsApp before they can receive messages. Fine for demo; production needs Twilio/Meta WhatsApp Business approval.
Escalation timers are in-memory (setTimeout). If Render restarts the process mid-escalation (rare with the cron-ping keep-alive, but possible), that specific in-progress escalation's timer is lost. A production system needs a persistent job schedule instead.
/voice/twiml must be reachable from the public internet for Twilio to call it — this is why PUBLIC_SERVER_URL must be your real Render URL, not localhost.
