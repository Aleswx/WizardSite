require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || "change-me";
// Comma-separated list of origins allowed to POST leads (your quiz's domain).
// Use "*" during local development.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim());

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.static(path.join(__dirname, "public")));

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

  if (!name || typeof score !== "number" || !tier) {
    return res.status(400).json({ error: "name, score and tier are required" });
  }

  try {
    const info = insertLead.run({
      name: String(name).slice(0, 200),
      email: email ? String(email).slice(0, 200) : null,
      phone: phone ? String(phone).slice(0, 60) : null,
      score,
      tier: String(tier).slice(0, 100),
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
