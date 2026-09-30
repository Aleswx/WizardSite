require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
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
const isCodespacesOrigin = (origin) => /^https:\/\/[^/]+-\d+\.app\.github\.dev$/.test(origin);

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
      if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin) || isCodespacesOrigin(origin)) {
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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(supabaseUrl && supabaseServiceKey);

let supabase = null;
let db;
let insertLead;

if (useSupabase) {
  supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // keep a consistent app API even when using Supabase
  db = {
    prepare() {
      return {
        all: () => [],
        get: () => ({ n: 0, avg: 0 }),
        run: () => ({ lastInsertRowid: null }),
      };
    },
  };

  insertLead = async ({ name, email, phone, score, tier, source, answers }) => {
    const { data, error } = await supabase.from("leads").insert({
      name,
      email,
      phone,
      score,
      tier,
      source,
      answers,
    }).select("id").single();

    if (error) throw error;
    return { lastInsertRowid: data.id };
  };
} else {
  db = new DatabaseSync(path.join(__dirname, "leads.db"));
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
      answers TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const leadColumns = db.prepare("PRAGMA table_info(leads)").all();
  if (!leadColumns.some((column) => column.name === "answers")) {
    db.exec("ALTER TABLE leads ADD COLUMN answers TEXT NOT NULL DEFAULT '[]'");
  }

  insertLead = db.prepare(`
    INSERT INTO leads (name, email, phone, score, tier, source, answers)
    VALUES (@name, @email, @phone, @score, @tier, @source, @answers)
  `);
}

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
app.post("/api/leads", async (req, res) => {
  const { name, email, phone, score, tier, source, answers } = req.body || {};
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanEmail = typeof email === "string" ? email.trim() : "";
  const cleanPhone = typeof phone === "string" ? phone.trim() : "";
  const cleanTier = typeof tier === "string" ? tier.trim() : "";
  const validAnswers = answers === undefined || (
    Array.isArray(answers) &&
    answers.length === 7 &&
    answers.every((item) =>
      item &&
      typeof item.question === "string" && item.question.trim() &&
      typeof item.answer === "string" && item.answer.trim() &&
      Number.isInteger(item.points) && item.points >= 0 && item.points <= 2
    )
  );

  if (!cleanName || !Number.isFinite(score) || score < 0 || score > 14 || !cleanTier || !validAnswers) {
    return res.status(400).json({ error: "name, valid score, tier and answers are required" });
  }

  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "invalid email" });
  }

  try {
    const cleanAnswers = (answers || []).map(({ question, answer, points }) => ({
      question: question.trim().slice(0, 500),
      answer: answer.trim().slice(0, 500),
      points,
    }));

    if (answers !== undefined && cleanAnswers.reduce((total, item) => total + item.points, 0) !== Math.round(score)) {
      return res.status(400).json({ error: "score does not match answers" });
    }

    const payload = {
      name: cleanName.slice(0, 200),
      email: cleanEmail ? cleanEmail.slice(0, 200) : null,
      phone: cleanPhone ? cleanPhone.slice(0, 60) : null,
      score: Math.round(score),
      tier: cleanTier.slice(0, 100),
      source: source ? String(source).slice(0, 60) : "quiz",
      answers: cleanAnswers,
    };

    if (useSupabase) {
      const info = await insertLead(payload);
      return res.status(201).json({ id: info.lastInsertRowid });
    }

    const info = insertLead.run({ ...payload, answers: JSON.stringify(cleanAnswers) });
    return res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "could not save lead" });
  }
});

// Protected: list leads for the dashboard
app.get("/api/leads", requireApiKey, async (req, res) => {
  if (useSupabase) {
    const { data, error } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const rows = db.prepare("SELECT * FROM leads ORDER BY created_at DESC").all();
  return res.json(rows);
});

// Protected: aggregated stats for the dashboard
app.get("/api/stats", requireApiKey, async (req, res) => {
  if (useSupabase) {
    const { data, error } = await supabase.from("leads").select("score, tier, created_at");
    if (error) return res.status(500).json({ error: error.message });

    const total = data.length;
    const byTier = Object.entries(
      data.reduce((acc, row) => {
        acc[row.tier] = (acc[row.tier] || 0) + 1;
        return acc;
      }, {})
    ).map(([tier, n]) => ({ tier, n })).sort((a, b) => b.n - a.n);

    const byDay = Object.entries(
      data.reduce((acc, row) => {
        const day = new Date(row.created_at).toISOString().slice(0, 10);
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      }, {})
    ).map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day)).slice(-30);

    const avgScore = data.length ? (data.reduce((sum, row) => sum + Number(row.score), 0) / data.length) : 0;
    return res.json({ total, byTier, byDay, avgScore });
  }

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
