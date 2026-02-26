import { type Request, type Response } from "express";
import { createAuthApp } from "./shared";

const app = createAuthApp();

app.get("/api/auth/me", (req: Request, res: Response) => {
  if (!(req as any).session?.adminId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }
  res.json({
    id: (req as any).session.adminId,
    email: (req as any).session.adminEmail,
  });
});

app.all("*", (_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

export default async function handler(req: Request, res: Response) {
  app(req, res);
}
