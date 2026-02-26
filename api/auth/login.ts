import { type VercelRequest, type VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { db } from "../../server/lib/db";
import { adminUsers } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { signSession, setSessionCookie } from "../../server/lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

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
        const token = signSession({ adminId: admin.id, adminEmail: admin.email });
        setSessionCookie(res as any, token);
        return res.json({ ok: true, email: admin.email });
      }
    }

    // 2. Fallback to environment variables
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (adminEmail && adminPassword && email === adminEmail && password === adminPassword) {
      const token = signSession({ adminId: "admin-env", adminEmail: adminEmail });
      setSessionCookie(res as any, token);
      return res.json({ ok: true, email: adminEmail });
    }

    return res.status(401).json({ ok: false, error: "Invalid credentials" });
  } catch (err: any) {
    console.error("LOGIN_ERROR", err);
    return res.status(500).json({ ok: false, error: "Login failed", detail: String(err?.message || err) });
  }
}
