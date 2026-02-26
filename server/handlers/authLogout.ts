import { type Request, type Response } from "express";
import { createAuthApp } from "./shared";

const app = createAuthApp();

app.post("/api/auth/logout", (req: Request, res: Response) => {
  if (!(req as any).session?.adminId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }
  (req as any).session.destroy((err: any) => {
    if (err) return res.status(500).json({ ok: false, error: "Logout failed" });
    res.json({ ok: true });
  });
});

app.all("*", (_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

export default async function handler(req: Request, res: Response) {
  app(req, res);
}
