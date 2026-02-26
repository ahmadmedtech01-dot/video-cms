import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { db } from "./db";
import { adminUsers, systemSettings } from "@shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
});

// Prevent Vite's customLogger from calling process.exit(1) on compilation
// errors (e.g. PostCSS warnings escalated to errors). Only allow clean
// exits (code 0) to propagate; all error exits are logged and suppressed.
const _originalExit = process.exit.bind(process);
(process as any).exit = (code?: number | string) => {
  const c = code === undefined ? 0 : Number(code);
  if (c === 0) {
    _originalExit(0);
  } else {
    console.error(`[server] process.exit(${c}) suppressed — server kept alive`);
  }
};

const app = express();
const httpServer = createServer(app);

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

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

const PgSession = connectPgSimple(session);
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
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
    },
  })
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 300) logLine = logLine.slice(0, 300) + "...";
      log(logLine);
    }
  });

  next();
});

async function seedAdmin() {
  try {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;
    const existing = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
    if (existing.length === 0) {
      const passwordHash = await bcrypt.hash(password, 12);
      await db.insert(adminUsers).values({ email, passwordHash });
      log(`Admin user seeded: ${email}`);
    }
  } catch (e) {
    log(`Seed admin error: ${e}`);
  }
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
  } catch (e) {
    log(`Seed settings error: ${e}`);
  }
}

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, async () => {
    log(`serving on port ${port}`);
    await seedAdmin();
    await seedDefaultSettings();
  });
})();
