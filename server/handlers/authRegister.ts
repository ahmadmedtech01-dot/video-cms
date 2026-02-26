import { type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { adminUsers } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { createAuthApp, handleAuthError } from "./shared";

const app = createAuthApp();

app.post("/api/auth/register", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, error: "Email and password required" });
    if (password.length < 8) return res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });

    // Check existing
    const [existing] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    if (existing) {
      return res.status(409).json({ ok: false, error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [admin] = await db.insert(adminUsers).values({ email, passwordHash }).returning();

    (req as any).session.adminId = admin.id;
    (req as any).session.adminEmail = admin.email;
    await new Promise<void>((resolve, reject) => {
      (req as any).session.save((err: any) => (err ? reject(err) : resolve()));
    });

    return res.status(201).json({ ok: true, email: admin.email });
  } catch (err: any) {
    handleAuthError(err, res, "Registration failed");
  }
});

app.all("*", (_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

export default async function handler(req: Request, res: Response) {
  app(req, res);
}
