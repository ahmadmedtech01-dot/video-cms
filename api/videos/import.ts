import type { VercelRequest, VercelResponse } from "@vercel/node";
import { nanoid } from "nanoid";
import { db } from "../_lib/db.js";
import { getSessionFromRequest } from "../_lib/auth.js";
import { videos } from "../_lib/schema.js";

function parseString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = getSessionFromRequest(req as any);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const title = parseString(body.title);
    const sourceUrl = parseString(body.sourceUrl);
    if (!title || !sourceUrl) {
      return res.status(400).json({ error: "title and sourceUrl are required" });
    }

    const [created] = await db
      .insert(videos)
      .values({
        publicId: nanoid(12),
        title,
        description: parseString(body.description),
        author: parseString(body.author),
        tags: Array.isArray(body.tags) ? (body.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)) : [],
        sourceType: "direct_url",
        sourceUrl,
        status: "processing",
        available: true,
      })
      .returning();

    return res.status(200).json({ ok: true, status: "processing", videoId: created.id });
  } catch (error) {
    console.error("VIDEOS_IMPORT_ERROR", error);
    return res.status(500).json({ error: "Failed to import video" });
  }
}
