import express, { type Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db";

const PgSession = connectPgSimple(session);
const isProduction = process.env.NODE_ENV === "production" || !!process.env.VERCEL;

export function createAuthApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
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
  return app;
}

export function handleAuthError(err: any, res: Response, message: string) {
  console.error(`${message}:`, err);
  if (!res.headersSent) {
    res.status(500).json({ ok: false, error: message, detail: String(err?.message || err) });
  }
}
