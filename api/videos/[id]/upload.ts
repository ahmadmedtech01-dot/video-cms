import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq } from "drizzle-orm";
import { b2UploadBuffer } from "../../_lib/b2.js";
import { db } from "../../_lib/db.js";
import { getSessionFromRequest } from "../../_lib/auth.js";
import { parseMultipart } from "../../_lib/multipart.js";
import { storageConnections, videos } from "../../_lib/schema.js";

function asArrayOfNumbers(value: string | undefined): number[] {
  if (!value) return [720];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [720];
    return parsed
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
  } catch {
    return [720];
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = getSessionFromRequest(req as any);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const id = String(req.query.id || "").trim();
    if (!id) return res.status(400).json({ error: "id is required" });

    const [video] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
    if (!video) return res.status(404).json({ error: "Video not found" });

    const parsed = await parseMultipart(req);
    if (!parsed.file) {
      return res.status(400).json({ error: "file is required" });
    }

    const connectionId = (parsed.fields.connectionId || "").trim();
    let conn;
    if (connectionId) {
      [conn] = await db.select().from(storageConnections).where(eq(storageConnections.id, connectionId)).limit(1);
    }
    if (!conn) {
      [conn] = await db.select().from(storageConnections).where(eq(storageConnections.isActive, true)).limit(1);
    }

    if (!conn || conn.provider !== "backblaze_b2") {
      return res.status(400).json({ error: "No active backblaze_b2 storage connection" });
    }

    const cfg = (conn.config || {}) as Record<string, unknown>;
    const endpoint = typeof cfg.endpoint === "string" ? cfg.endpoint : "";
    const bucket = typeof cfg.bucket === "string" ? cfg.bucket : "";
    const rawPrefix = typeof cfg.rawPrefix === "string" && cfg.rawPrefix ? cfg.rawPrefix : "raw/";

    const safeFilename = parsed.file.filename || "upload.bin";
    const key = `${rawPrefix.endsWith("/") ? rawPrefix : `${rawPrefix}/`}${video.id}/${safeFilename}`;

    await b2UploadBuffer({
      endpoint,
      bucket,
      key,
      contentType: parsed.file.mimeType,
      body: parsed.file.buffer,
    });

    const qualities = asArrayOfNumbers(parsed.fields.qualities);
    await db
      .update(videos)
      .set({
        rawS3Key: key,
        storageConnectionId: conn.id,
        status: "processing",
        qualities,
        fileSize: parsed.file.buffer.length,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, id));

    return res.status(200).json({ ok: true, message: "File uploaded to Backblaze B2" });
  } catch (error: any) {
    console.error("VIDEO_UPLOAD_ERROR", error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
}
