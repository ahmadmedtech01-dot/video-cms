import express, { type Request, type Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.SUPABASE_DATABASE_URL ? { rejectUnauthorized: false } : undefined,
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

pool.on("connect", (client) => {
  client.query("SET search_path TO public").catch(() => {});
});

pool.on("error", (err) => {
  console.error("[auth] Pool idle error:", err.message);
});

const PgSession = connectPgSimple(session);
const isProduction = process.env.NODE_ENV === "production" || !!process.env.VERCEL;

const app = express();
app.set("trust proxy", 1);
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "secure-video-cms-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
    },
  }),
);

app.all("/api/auth/login", async (req: Request, res: Response) => {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password required" });
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      const missing: string[] = [];
      if (!adminEmail) missing.push("ADMIN_EMAIL");
      if (!adminPassword) missing.push("ADMIN_PASSWORD");
      return res.status(500).json({ ok: false, error: "Server configuration error", missing });
    }

    if (email !== adminEmail || password !== adminPassword) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    (req as any).session.adminId = "admin";
    (req as any).session.adminEmail = adminEmail;
    await new Promise<void>((resolve, reject) => {
      (req as any).session.save((err: any) => (err ? reject(err) : resolve()));
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("LOGIN_FUNCTION_ERROR", { message: err?.message, stack: err?.stack });
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err?.message || err) });
  }
});

app.all("*", (_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

let initPromise: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = pool.query("SELECT 1")
      .then(() => { console.log("[auth] DB connection verified"); })
      .catch((err: any) => {
        console.error("[auth] DB connection failed:", err);
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}

export default async function handler(req: Request, res: Response) {
  try {
    await ensureInit();
  } catch (err: any) {
    console.error("[auth] Handler init failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        ok: false,
        error: "Server initialization failed",
        detail: String(err?.message || err),
      });
    }
    return;
  }
  app(req, res);
}
