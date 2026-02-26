import { type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { adminUsers } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { createAuthApp, handleAuthError } from "./shared";

const app = createAuthApp();

app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password required" });
    }

    // 1. Check database first
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    if (admin) {
      const valid = await bcrypt.compare(password, admin.passwordHash);
      if (valid) {
        (req as any).session.adminId = admin.id;
        (req as any).session.adminEmail = admin.email;
        await new Promise<void>((resolve, reject) => {
          (req as any).session.save((err: any) => (err ? reject(err) : resolve()));
        });
        return res.json({ ok: true, email: admin.email });
      }
    }

    // 2. Fallback to environment variables
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (adminEmail && adminPassword && email === adminEmail && password === adminPassword) {
      (req as any).session.adminId = "admin-env";
      (req as any).session.adminEmail = adminEmail;
      await new Promise<void>((resolve, reject) => {
        (req as any).session.save((err: any) => (err ? reject(err) : resolve()));
      });
      return res.json({ ok: true, email: adminEmail });
    }

    return res.status(401).json({ ok: false, error: "Invalid credentials" });
  } catch (err: any) {
    handleAuthError(err, res, "Login failed");
  }
});

app.all("*", (_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

export default async function handler(req: Request, res: Response) {
  app(req, res);
}
