import type { VercelRequest, VercelResponse } from "@vercel/node";
import { desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../_lib/db.js";
import { getSessionFromRequest } from "../_lib/auth.js";
import { videos } from "../_lib/schema.js";

function parseString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = getSessionFromRequest(req as any);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (req.method === "GET") {
      const rows = await db.select().from(videos).orderBy(desc(videos.createdAt));
      return res.status(200).json(rows);
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const title = parseString(body.title);
    if (!title) {
      return res.status(400).json({ error: "title is required" });
    }

    const [created] = await db
      .insert(videos)
      .values({
        publicId: nanoid(12),
        title,
        description: parseString(body.description),
        author: parseString(body.author),
        tags: Array.isArray(body.tags) ? (body.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)) : [],
        sourceType: parseString(body.sourceType) || "upload",
        sourceUrl: parseString(body.sourceUrl) || null,
        status: "uploading",
        available: true,
      })
      .returning();

    return res.status(200).json(created);
  } catch (error) {
    console.error("VIDEOS_INDEX_ERROR", error);
    return res.status(500).json({ error: "Failed to handle video request" });
  }
}
