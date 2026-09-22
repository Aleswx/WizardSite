require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT) || 3000;
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY;

if (!DASHBOARD_API_KEY) {
  console.error("FATAL: DASHBOARD_API_KEY is required. Set it in the environment before starting the server.");
  process.exit(1);
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(express.json({ limit: "200kb" }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key"],
  })
);
app.use(express.static(path.join(__dirname, "public")));
const leadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many requests" },
});
app.use("/api/leads", leadLimiter);

// ---------- database ----------
const db = new DatabaseSync(path.join(__dirname, "leads.db"));
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    score INTEGER NOT NULL,
    tier TEXT NOT NULL,
    source TEXT DEFAULT 'quiz',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertLead = db.prepare(`
  INSERT INTO leads (name, email, phone, score, tier, source)
  VALUES (@name, @email, @phone, @score, @tier, @source)
`);

// ---------- auth middleware for dashboard endpoints ----------
function requireApiKey(req, res, next) {
  const key = req.header("x-api-key");
  if (!key || key !== DASHBOARD_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// ---------- routes ----------

// Public: quiz posts a new lead here
app.post("/api/leads", (req, res) => {
  const { name, email, phone, score, tier, source } = req.body || {};
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanEmail = typeof email === "string" ? email.trim() : "";
  const cleanPhone = typeof phone === "string" ? phone.trim() : "";
  const cleanTier = typeof tier === "string" ? tier.trim() : "";

  if (!cleanName || !Number.isFinite(score) || score < 0 || score > 14 || !cleanTier) {
    return res.status(400).json({ error: "name, valid score and tier are required" });
  }

  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "invalid email" });
  }

  try {
    const info = insertLead.run({
      name: cleanName.slice(0, 200),
      email: cleanEmail ? cleanEmail.slice(0, 200) : null,
      phone: cleanPhone ? cleanPhone.slice(0, 60) : null,
      score: Math.round(score),
      tier: cleanTier.slice(0, 100),
      source: source ? String(source).slice(0, 60) : "quiz",
    });
    return res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "could not save lead" });
  }
});

// Protected: list leads for the dashboard
app.get("/api/leads", requireApiKey, (req, res) => {
  const rows = db.prepare("SELECT * FROM leads ORDER BY created_at DESC").all();
  res.json(rows);
});

// Protected: aggregated stats for the dashboard
app.get("/api/stats", requireApiKey, (req, res) => {
  const total = db.prepare("SELECT COUNT(*) AS n FROM leads").get().n;

  const byTier = db
    .prepare("SELECT tier, COUNT(*) AS n FROM leads GROUP BY tier ORDER BY n DESC")
    .all();

  const byDay = db
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS n
       FROM leads
       GROUP BY day
       ORDER BY day ASC
       LIMIT 30`
    )
    .all();

  const avgScore = db.prepare("SELECT AVG(score) AS avg FROM leads").get().avg;

  res.json({ total, byTier, byDay, avgScore: avgScore || 0 });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Quiz leads API running on port ${PORT}`);
});
