import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createServer } from "http";
import { pool, db } from "../server/db";
import { registerRoutes } from "../server/routes";
import { adminUsers, systemSettings } from "../shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    adminId: string;
    adminEmail: string;
  }
}

const app = express();
const httpServer = createServer(app);

// Trust Vercel's reverse proxy so secure cookies and req.ip work correctly.
app.set("trust proxy", 1);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false }));

const PgSession = connectPgSimple(session);
const isProduction = process.env.NODE_ENV === "production" || !!process.env.VERCEL;

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

async function seedAdmin() {
  try {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;
    const existing = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
    if (existing.length === 0) {
      const passwordHash = await bcrypt.hash(password, 12);
      await db.insert(adminUsers).values({ email, passwordHash });
    }
  } catch {}
}

async function seedDefaultSettings() {
  try {
    const defaults = [
      { key: "global_kill_switch", value: "false" },
      { key: "aws_access_key_id", value: "" },
      { key: "aws_secret_access_key", value: "" },
      { key: "aws_region", value: "us-east-1" },
      { key: "s3_bucket", value: "" },
      { key: "s3_private_prefix", value: "raw/" },
      { key: "s3_hls_prefix", value: "hls/" },
      { key: "signing_secret", value: process.env.SIGNING_SECRET || "change-me-secret" },
      { key: "ffmpeg_enabled", value: "true" },
      { key: "max_upload_size_mb", value: "2048" },
    ];
    for (const d of defaults) {
      const existing = await db.select().from(systemSettings).where(eq(systemSettings.key, d.key));
      if (existing.length === 0) {
        await db.insert(systemSettings).values(d);
      }
    }
  } catch {}
}

let initPromise: Promise<void> | null = null;

async function init() {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  await seedAdmin();
  await seedDefaultSettings();
}

function ensureInit() {
  if (!initPromise) initPromise = init();
  return initPromise;
}

export default async function handler(req: Request, res: Response) {
  await ensureInit();
  return app(req, res);
}
