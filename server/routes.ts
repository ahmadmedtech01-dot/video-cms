import type { Express } from "express";
import { type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { storage } from "./storage";
import { spawn } from "child_process";
import os from "os";

function log(message: string) {
  const t = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${t} [routes] ${message}`);
}

// Middleware
function requireAuth(req: any, res: any, next: any) {
  if (!req.session?.adminId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

// Multer setup
const uploadDir = path.join(os.tmpdir(), "vcms-uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4GB
});

// S3 helpers
async function getS3Client() {
  const ak = await storage.getSetting("aws_access_key_id");
  const sk = await storage.getSetting("aws_secret_access_key");
  const region = await storage.getSetting("aws_region");
  if (!ak || !sk || !region) return null;
  return new S3Client({ region, credentials: { accessKeyId: ak, secretAccessKey: sk } });
}

async function getS3Config() {
  return {
    bucket: (await storage.getSetting("s3_bucket")) || "",
    rawPrefix: (await storage.getSetting("s3_private_prefix")) || "raw/",
    hlsPrefix: (await storage.getSetting("s3_hls_prefix")) || "hls/",
  };
}

// ── Ingest helpers ─────────────────────────────────────────

async function downloadToTempFile(url: string, headers: Record<string, string> = {}): Promise<string> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  if (!response.body) throw new Error("No response body");
  const { pipeline } = await import("stream/promises");
  const { Readable } = await import("stream");
  const tmpPath = path.join(os.tmpdir(), `vcms-ingest-${nanoid()}.mp4`);
  const fileStream = fs.createWriteStream(tmpPath);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);
  return tmpPath;
}

async function transcodeAndStoreHls(videoId: string, inputPath: string, qualities: number[]): Promise<void> {
  const hlsOutputDir = path.join(os.tmpdir(), "vcms-hls", videoId);
  await runFfmpegHls(inputPath, hlsOutputDir, qualities);
  const client = await getS3Client();
  const cfg = await getS3Config();
  if (client && cfg.bucket) {
    const hlsPrefix = `${cfg.hlsPrefix}${videoId}/`;
    await uploadHlsToS3(hlsOutputDir, hlsPrefix);
    await storage.updateVideo(videoId, { status: "ready", hlsS3Prefix: hlsPrefix, lastError: null });
    try { fs.rmSync(hlsOutputDir, { recursive: true }); } catch {}
  } else {
    const localHlsDir = path.join(uploadDir, "hls", videoId);
    if (fs.existsSync(localHlsDir)) fs.rmSync(localHlsDir, { recursive: true });
    fs.cpSync(hlsOutputDir, localHlsDir, { recursive: true });
    await storage.updateVideo(videoId, { status: "ready", hlsS3Prefix: localHlsDir, lastError: null });
    try { fs.rmSync(hlsOutputDir, { recursive: true }); } catch {}
  }
  log(`Ingest/transcode complete for video ${videoId}`);
}

async function ingestDirectMp4(videoId: string, url: string): Promise<void> {
  log(`Ingesting direct URL for video ${videoId}: ${url}`);
  const tmpPath = await downloadToTempFile(url);
  try {
    await transcodeAndStoreHls(videoId, tmpPath, [720, 480, 360]);
  } finally {
    try { fs.rmSync(tmpPath); } catch {}
  }
}

function extractVimeoId(input: string): string | null {
  // 1) Full iframe embed HTML: src="https://player.vimeo.com/video/1168001442?..."
  const iframeMatch = input.match(/player\.vimeo\.com\/video\/(\d+)/i);
  if (iframeMatch) return iframeMatch[1];
  // 2) Standard Vimeo URL: https://vimeo.com/1168001442 or https://vimeo.com/video/1168001442
  const urlMatch = input.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (urlMatch) return urlMatch[1];
  return null;
}

async function ingestVimeoVideo(videoId: string, vimeoUrl: string): Promise<void> {
  const vimeoToken = process.env.VIMEO_ACCESS_TOKEN || (await storage.getSetting("vimeo_access_token")) || "";
  if (!vimeoToken) {
    throw new Error("Vimeo access token not configured. Set VIMEO_ACCESS_TOKEN in environment variables or add vimeo_access_token in System Settings.");
  }
  const vimeoVideoId = extractVimeoId(vimeoUrl);
  if (!vimeoVideoId) throw new Error("Could not parse Vimeo video ID from input");

  log(`Calling Vimeo API for video ID ${vimeoVideoId}...`);
  const apiRes = await fetch(`https://api.vimeo.com/videos/${vimeoVideoId}`, {
    headers: {
      Authorization: `Bearer ${vimeoToken}`,
      Accept: "application/vnd.vimeo.*+json;version=3.4",
    },
  });
  if (!apiRes.ok) {
    const err = await apiRes.json().catch(() => ({})) as any;
    throw new Error(`Vimeo API error (${apiRes.status}): ${err.error || err.message || "Unknown"}`);
  }
  const vimeoData = await apiRes.json() as any;

  const downloads: any[] = vimeoData.download || [];
  if (!downloads.length) {
    throw new Error("Vimeo file not available for download. Your Vimeo plan or video privacy settings do not expose download links. Please upgrade to Vimeo Pro or upload the file directly.");
  }
  downloads.sort((a: any, b: any) => (b.height || 0) - (a.height || 0));
  const best = downloads[0];
  if (!best?.link) throw new Error("No download link returned by Vimeo API");

  log(`Downloading Vimeo video ${vimeoVideoId} (${best.quality || "unknown"} quality)...`);
  const tmpPath = await downloadToTempFile(best.link, { Authorization: `Bearer ${vimeoToken}` });
  try {
    await transcodeAndStoreHls(videoId, tmpPath, [720, 480, 360]);
  } finally {
    try { fs.rmSync(tmpPath); } catch {}
  }
}

async function uploadToS3(localPath: string, s3Key: string, contentType: string): Promise<void> {
  const client = await getS3Client();
  if (!client) throw new Error("S3 not configured");
  const cfg = await getS3Config();
  const fileStream = fs.createReadStream(localPath);
  await client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: s3Key,
    Body: fileStream,
    ContentType: contentType,
  }));
}

async function generateSignedS3Url(key: string, ttlSeconds = 120): Promise<string> {
  const client = await getS3Client();
  if (!client) throw new Error("S3 not configured");
  const cfg = await getS3Config();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: ttlSeconds });
}

async function getSigningSecret(): Promise<string> {
  return (await storage.getSetting("signing_secret")) || "default-secret";
}

function generateToken(payload: object, ttlSeconds: number): string {
  const secret = process.env.SIGNING_SECRET || "signing-secret";
  return jwt.sign(payload, secret, { expiresIn: ttlSeconds });
}

function verifyToken(token: string): any {
  const secret = process.env.SIGNING_SECRET || "signing-secret";
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

// ffmpeg HLS processing
async function runFfmpegHls(
  inputPath: string,
  outputDir: string,
  qualities: number[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Build ffmpeg args for HLS
    const args: string[] = ["-i", inputPath, "-y"];

    const qualityMap: Record<number, { vf: string; b: string; ba: string; maxrate: string; bufsize: string }> = {
      240: { vf: "scale=-2:240", b: "400k", ba: "64k", maxrate: "500k", bufsize: "1000k" },
      360: { vf: "scale=-2:360", b: "800k", ba: "96k", maxrate: "900k", bufsize: "1800k" },
      480: { vf: "scale=-2:480", b: "1200k", ba: "128k", maxrate: "1400k", bufsize: "2800k" },
      720: { vf: "scale=-2:720", b: "2500k", ba: "128k", maxrate: "2800k", bufsize: "5600k" },
      1080: { vf: "scale=-2:1080", b: "5000k", ba: "192k", maxrate: "5500k", bufsize: "11000k" },
    };

    const selectedQualities = qualities.filter(q => qualityMap[q]);
    if (selectedQualities.length === 0) selectedQualities.push(720);

    selectedQualities.forEach((q, i) => {
      const cfg = qualityMap[q];
      args.push(
        `-map`, `0:v:0`, `-map`, `0:a:0`,
        `-c:v:${i}`, `libx264`, `-b:v:${i}`, cfg.b,
        `-maxrate:v:${i}`, cfg.maxrate, `-bufsize:v:${i}`, cfg.bufsize,
        `-vf:${i}`, cfg.vf, `-c:a:${i}`, `aac`, `-b:a:${i}`, cfg.ba
      );
    });

    // Master playlist stream map
    const streamMap = selectedQualities.map((_, i) => `v:${i},a:${i}`).join(" ");

    args.push(
      `-var_stream_map`, streamMap,
      `-master_pl_name`, `master.m3u8`,
      `-f`, `hls`,
      `-hls_time`, `6`,
      `-hls_list_size`, `0`,
      `-hls_segment_filename`, path.join(outputDir, "v%v/seg_%03d.ts"),
      path.join(outputDir, "v%v/index.m3u8")
    );

    log(`Running ffmpeg for HLS...`);
    const proc = spawn("ffmpeg", args);
    proc.stderr.on("data", (d) => process.stdout.write(d));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

// Upload HLS segments to S3
async function uploadHlsToS3(localDir: string, s3Prefix: string): Promise<void> {
  const client = await getS3Client();
  if (!client) throw new Error("S3 not configured");
  const cfg = await getS3Config();

  function walkDir(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      if (e.isDirectory()) files.push(...walkDir(path.join(dir, e.name)));
      else files.push(path.join(dir, e.name));
    }
    return files;
  }

  const files = walkDir(localDir);
  for (const file of files) {
    const relPath = path.relative(localDir, file);
    const s3Key = `${s3Prefix}${relPath}`.replace(/\\/g, "/");
    const contentType = file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/MP2T";
    const fileData = fs.readFileSync(file);
    await client.send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: s3Key,
      Body: fileData,
      ContentType: contentType,
    }));
  }
}

// Rewrite m3u8 playlist with signed URLs
async function rewritePlaylistWithSignedUrls(
  playlistContent: string,
  s3Prefix: string,
  ttl: number
): Promise<string> {
  const lines = playlistContent.split("\n");
  const rewritten: string[] = [];
  for (const line of lines) {
    if (line.trim() && !line.startsWith("#") && (line.endsWith(".ts") || line.endsWith(".m3u8"))) {
      const segKey = s3Prefix + line.trim().replace(/^.*\//, (m) => {
        const parts = line.trim().split("/");
        return parts.length > 1 ? parts.slice(-2).join("/") : parts[parts.length - 1];
      });
      try {
        const signed = await generateSignedS3Url(segKey, ttl);
        rewritten.push(signed);
      } catch {
        rewritten.push(line);
      }
    } else {
      rewritten.push(line);
    }
  }
  return rewritten.join("\n");
}

// Routes
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ── Auth ──────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password required" });

      const admin = await storage.getAdminByEmail(email);
      if (!admin) return res.status(401).json({ message: "Invalid credentials" });

      const valid = await bcrypt.compare(password, admin.passwordHash);
      if (!valid) return res.status(401).json({ message: "Invalid credentials" });

      req.session.adminId = admin.id;
      req.session.adminEmail = admin.email;
      res.json({ ok: true, email: admin.email });
    } catch (e) {
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", requireAuth, (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.session?.adminId) return res.status(401).json({ message: "Not authenticated" });
    res.json({ id: req.session.adminId, email: req.session.adminEmail });
  });

  // ── Videos ────────────────────────────────────────────────
  app.get("/api/videos", requireAuth, async (req, res) => {
    const vids = await storage.getVideos();
    res.json(vids);
  });

  app.post("/api/videos", requireAuth, async (req, res) => {
    try {
      const { title, description, author, tags, sourceType, sourceUrl } = req.body;
      const publicId = nanoid(10);
      const video = await storage.createVideo({
        title: title || "Untitled Video",
        description: description || "",
        author: author || "",
        tags: tags || [],
        publicId,
        status: sourceType === "upload" ? "uploading" : "ready",
        sourceType: sourceType || "upload",
        sourceUrl: sourceUrl || null,
        available: true,
      });
      // Create default settings
      await storage.upsertPlayerSettings(video.id, {});
      await storage.upsertWatermarkSettings(video.id, {});
      await storage.upsertSecuritySettings(video.id, {});
      await storage.createAuditLog({ action: "video_created", meta: { videoId: video.id, title: video.title }, ip: req.ip });
      res.json(video);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/videos/:id", requireAuth, async (req, res) => {
    const v = await storage.getVideoById(req.params.id);
    if (!v) return res.status(404).json({ message: "Not found" });
    const playerSettings = await storage.getPlayerSettings(v.id);
    const watermarkSettings = await storage.getWatermarkSettings(v.id);
    const securitySettings = await storage.getSecuritySettings(v.id);
    res.json({ ...v, playerSettings, watermarkSettings, securitySettings });
  });

  app.put("/api/videos/:id", requireAuth, async (req, res) => {
    try {
      const { title, description, author, tags, available, sourceType, sourceUrl } = req.body;
      const v = await storage.updateVideo(req.params.id, { title, description, author, tags, available, sourceType, sourceUrl });
      if (!v) return res.status(404).json({ message: "Not found" });
      await storage.createAuditLog({ action: "video_updated", meta: { videoId: v.id }, ip: req.ip });
      res.json(v);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/videos/:id", requireAuth, async (req, res) => {
    const v = await storage.getVideoById(req.params.id);
    if (!v) return res.status(404).json({ message: "Not found" });
    await storage.deleteVideo(req.params.id);
    await storage.createAuditLog({ action: "video_deleted", meta: { videoId: req.params.id, title: v.title }, ip: req.ip });
    res.json({ ok: true });
  });

  // ── Import endpoint (ingest & convert) ───────────────────
  app.post("/api/videos/import", requireAuth, async (req, res) => {
    try {
      const { sourceUrl, title, description, author, tags } = req.body;
      if (!sourceUrl?.trim()) return res.status(400).json({ message: "sourceUrl is required" });

      const rawInput = sourceUrl.trim();

      // Check Vimeo first (handles both iframe HTML and URLs)
      const vimeoId = extractVimeoId(rawInput);
      const isVimeo = !!vimeoId;
      // Normalize to canonical vimeo URL if matched
      const url = isVimeo ? `https://vimeo.com/${vimeoId}` : rawInput;

      const isYouTube = !isVimeo && /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(rawInput);
      const isM3u8 = !isVimeo && /\.m3u8(\?|$)/i.test(url);

      let sourceType: string;
      let initialStatus: string;
      let lastError: string | null = null;

      if (isYouTube) {
        sourceType = "youtube_blocked";
        initialStatus = "error";
        lastError = "YouTube links cannot be played in our custom player. Please upload the video file or provide a direct HLS (.m3u8) or MP4 URL.";
      } else if (isVimeo) {
        sourceType = "vimeo_ingest";
        initialStatus = "processing";
      } else if (isM3u8) {
        sourceType = "direct_url";
        initialStatus = "ready";
      } else {
        sourceType = "direct_url";
        initialStatus = "processing";
      }

      const publicId = nanoid(10);
      const video = await storage.createVideo({
        title: title || "Untitled Video",
        description: description || "",
        author: author || "",
        tags: tags || [],
        publicId,
        status: initialStatus,
        sourceType,
        sourceUrl: url,
        available: true,
        lastError,
      } as any);

      await storage.upsertPlayerSettings(video.id, {});
      await storage.upsertWatermarkSettings(video.id, {});
      await storage.upsertSecuritySettings(video.id, {});
      await storage.createAuditLog({ action: "video_imported", meta: { videoId: video.id, sourceType, url }, ip: req.ip });

      if (sourceType === "vimeo_ingest") {
        ingestVimeoVideo(video.id, url).catch(async (e: Error) => {
          log(`Vimeo ingest failed for ${video.id}: ${e.message}`);
          await storage.updateVideo(video.id, { status: "error", lastError: e.message } as any);
        });
      } else if (sourceType === "direct_url" && initialStatus === "processing") {
        ingestDirectMp4(video.id, url).catch(async (e: Error) => {
          log(`Direct ingest failed for ${video.id}: ${e.message}`);
          await storage.updateVideo(video.id, { status: "error", lastError: e.message } as any);
        });
      }

      res.json({ videoId: video.id, publicId: video.publicId, status: video.status, message: lastError || (initialStatus === "processing" ? "Ingestion started" : "Video ready") });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Build / rebuild HLS from existing source URL ───────────
  app.post("/api/videos/:id/build-hls-from-source", requireAuth, async (req, res) => {
    try {
      const video = await storage.getVideoById(req.params.id);
      if (!video) return res.status(404).json({ message: "Video not found" });

      const { sourceType, sourceUrl } = video;

      if (sourceType === "youtube" || sourceType === "youtube_blocked") {
        return res.status(400).json({ message: "YouTube links cannot be converted. Please upload the video file directly." });
      }

      if (sourceType === "vimeo" || sourceType === "vimeo_ingest") {
        if (!sourceUrl) return res.status(400).json({ message: "No source URL on this video." });
        await storage.updateVideo(video.id, { status: "processing", lastError: null } as any);
        ingestVimeoVideo(video.id, sourceUrl).catch(async (e: Error) => {
          log(`Build HLS (Vimeo) failed for ${video.id}: ${e.message}`);
          await storage.updateVideo(video.id, { status: "error", lastError: e.message } as any);
        });
        await storage.createAuditLog({ action: "video_build_hls_started", meta: { videoId: video.id, sourceType }, ip: req.ip });
        return res.json({ ok: true, message: "Vimeo ingest started. The video will be ready in a few minutes." });
      }

      if (sourceType === "direct_url") {
        if (!sourceUrl) return res.status(400).json({ message: "No source URL on this video." });
        if (/\.m3u8/i.test(sourceUrl)) {
          // Already a direct HLS URL, mark ready
          await storage.updateVideo(video.id, { status: "ready" } as any);
          return res.json({ ok: true, message: "Video is a direct HLS stream and is now marked ready." });
        }
        await storage.updateVideo(video.id, { status: "processing", lastError: null } as any);
        ingestDirectMp4(video.id, sourceUrl).catch(async (e: Error) => {
          log(`Build HLS (direct MP4) failed for ${video.id}: ${e.message}`);
          await storage.updateVideo(video.id, { status: "error", lastError: e.message } as any);
        });
        await storage.createAuditLog({ action: "video_build_hls_started", meta: { videoId: video.id, sourceType }, ip: req.ip });
        return res.json({ ok: true, message: "HLS conversion started. The video will be ready in a few minutes." });
      }

      return res.status(400).json({ message: `Cannot auto-generate HLS for sourceType '${sourceType}'. Please re-upload the video file.` });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/videos/:id/toggle-availability", requireAuth, async (req, res) => {
    const v = await storage.getVideoById(req.params.id);
    if (!v) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateVideo(req.params.id, { available: !v.available });
    await storage.createAuditLog({ action: "video_availability_toggled", meta: { videoId: v.id, available: updated?.available }, ip: req.ip });
    res.json(updated);
  });

  // Upload video file → S3 → ffmpeg HLS
  app.post("/api/videos/:id/upload", requireAuth, upload.single("file"), async (req: any, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file uploaded" });

    const video = await storage.getVideoById(req.params.id);
    if (!video) return res.status(404).json({ message: "Video not found" });

    try {
      await storage.updateVideo(video.id, { status: "uploading" });
      const cfg = await getS3Config();
      const rawKey = `${cfg.rawPrefix}${video.id}/${file.originalname}`;
      const hlsPrefix = `${cfg.hlsPrefix}${video.id}/`;

      // Try S3 upload
      const client = await getS3Client();
      if (client && cfg.bucket) {
        await uploadToS3(file.path, rawKey, file.mimetype);
        await storage.updateVideo(video.id, { rawS3Key: rawKey, status: "processing" });
      } else {
        // Store locally if S3 not configured
        const localVideoDir = path.join(uploadDir, "videos", video.id);
        if (!fs.existsSync(localVideoDir)) fs.mkdirSync(localVideoDir, { recursive: true });
        const destPath = path.join(localVideoDir, file.originalname);
        fs.copyFileSync(file.path, destPath);
        await storage.updateVideo(video.id, { rawS3Key: destPath, status: "processing" });
      }

      // ffmpeg HLS processing (async)
      const qualities = req.body.qualities ? JSON.parse(req.body.qualities) : [720];
      const hlsOutputDir = path.join(os.tmpdir(), "vcms-hls", video.id);

      storage.updateVideo(video.id, { status: "processing" });

      (async () => {
        try {
          await runFfmpegHls(file.path, hlsOutputDir, qualities);
          if (client && cfg.bucket) {
            await uploadHlsToS3(hlsOutputDir, hlsPrefix);
            await storage.updateVideo(video.id, {
              status: "ready",
              hlsS3Prefix: hlsPrefix,
              qualities,
            });
          } else {
            // Store HLS locally
            const localHlsDir = path.join(uploadDir, "hls", video.id);
            if (fs.existsSync(localHlsDir)) fs.rmSync(localHlsDir, { recursive: true });
            fs.cpSync(hlsOutputDir, localHlsDir, { recursive: true });
            await storage.updateVideo(video.id, {
              status: "ready",
              hlsS3Prefix: localHlsDir,
              qualities,
            });
          }
          // Cleanup
          try { fs.rmSync(file.path); } catch {}
          try { fs.rmSync(hlsOutputDir, { recursive: true }); } catch {}
          log(`HLS processing complete for video ${video.id}`);
        } catch (e) {
          log(`HLS processing failed for video ${video.id}: ${e}`);
          await storage.updateVideo(video.id, { status: "error" });
        }
      })();

      res.json({ ok: true, message: "Upload started, processing in background" });
    } catch (e: any) {
      await storage.updateVideo(video.id, { status: "error" });
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/videos/:id/thumbnail", requireAuth, upload.single("thumbnail"), async (req: any, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file" });
    const video = await storage.getVideoById(req.params.id);
    if (!video) return res.status(404).json({ message: "Not found" });

    try {
      const client = await getS3Client();
      const cfg = await getS3Config();
      let thumbUrl = "";
      if (client && cfg.bucket) {
        const key = `thumbnails/${video.id}/${file.originalname}`;
        await uploadToS3(file.path, key, file.mimetype);
        thumbUrl = await generateSignedS3Url(key, 3600 * 24 * 30);
      } else {
        // Store locally and serve
        const dir = path.join("client/public/thumbnails");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, `${video.id}-${file.originalname}`);
        fs.copyFileSync(file.path, dest);
        thumbUrl = `/thumbnails/${video.id}-${file.originalname}`;
      }
      await storage.updateVideo(video.id, { thumbnailUrl: thumbUrl });
      try { fs.rmSync(file.path); } catch {}
      res.json({ thumbnailUrl: thumbUrl });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Settings
  app.put("/api/videos/:id/player-settings", requireAuth, async (req, res) => {
    const s = await storage.upsertPlayerSettings(req.params.id, req.body);
    await storage.createAuditLog({ action: "player_settings_updated", meta: { videoId: req.params.id }, ip: req.ip });
    res.json(s);
  });

  app.put("/api/videos/:id/watermark-settings", requireAuth, async (req, res) => {
    const s = await storage.upsertWatermarkSettings(req.params.id, req.body);
    await storage.createAuditLog({ action: "watermark_settings_updated", meta: { videoId: req.params.id }, ip: req.ip });
    res.json(s);
  });

  app.put("/api/videos/:id/security-settings", requireAuth, async (req, res) => {
    const s = await storage.upsertSecuritySettings(req.params.id, req.body);
    await storage.createAuditLog({ action: "security_settings_updated", meta: { videoId: req.params.id }, ip: req.ip });
    res.json(s);
  });

  // ── Embed Tokens ──────────────────────────────────────────
  app.get("/api/videos/:id/tokens", requireAuth, async (req, res) => {
    const tokens = await storage.getEmbedTokensByVideo(req.params.id);
    res.json(tokens);
  });

  app.post("/api/videos/:id/tokens", requireAuth, async (req, res) => {
    try {
      const video = await storage.getVideoById(req.params.id);
      if (!video) return res.status(404).json({ message: "Video not found" });

      const { label, allowedDomain, ttlHours } = req.body;
      const ttlSecs = (ttlHours || 24) * 3600;
      const expiresAt = new Date(Date.now() + ttlSecs * 1000);
      const tokenValue = generateToken({ videoId: video.id, publicId: video.publicId }, ttlSecs);

      const token = await storage.createEmbedToken({
        videoId: video.id,
        token: tokenValue,
        label: label || "Embed Token",
        allowedDomain: allowedDomain || null,
        expiresAt,
        revoked: false,
      });
      await storage.createAuditLog({ action: "token_created", meta: { videoId: video.id, tokenId: token.id }, ip: req.ip });
      res.json(token);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/tokens", requireAuth, async (req, res) => {
    const tokens = await storage.getAllTokens();
    res.json(tokens);
  });

  app.post("/api/tokens/:id/revoke", requireAuth, async (req, res) => {
    await storage.revokeToken(req.params.id);
    await storage.createAuditLog({ action: "token_revoked", meta: { tokenId: req.params.id }, ip: req.ip });
    res.json({ ok: true });
  });

  app.delete("/api/tokens/:id", requireAuth, async (req, res) => {
    await storage.deleteToken(req.params.id);
    res.json({ ok: true });
  });

  // ── Admin preview token ──────────────────────────────────
  app.get("/api/videos/:id/admin-preview-token", requireAuth, async (req, res) => {
    try {
      const video = await storage.getVideoById(req.params.id);
      if (!video) return res.status(404).json({ message: "Not found" });
      const token = generateToken({ videoId: video.id, publicId: video.publicId, adminPreview: true }, 600);
      res.json({ token, publicId: video.publicId });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Player (public) ───────────────────────────────────────
  app.get("/api/player/:publicId/manifest", async (req, res) => {
    try {
      // Global kill switch
      const killed = await storage.getSetting("global_kill_switch");
      if (killed === "true") return res.status(503).json({ message: "Service temporarily disabled" });

      const video = await storage.getVideoByPublicId(req.params.publicId);
      if (!video) return res.status(404).json({ message: "Video not found" });
      if (!video.available) return res.status(403).json({ message: "Video unavailable" });
      if (video.status === "processing" || video.status === "uploading") {
        return res.status(202).json({ message: "Video is being processed", status: "processing" });
      }
      if (video.status === "error") {
        return res.status(400).json({ message: (video as any).lastError || "Video processing failed", status: "error" });
      }
      if (video.status !== "ready") return res.status(400).json({ message: "Video not ready" });

      const secSettings = await storage.getSecuritySettings(video.id);
      const token = req.query.token as string;

      // Check for admin preview token — bypasses all security checks
      let isAdminPreview = false;
      if (token) {
        try {
          const decoded = verifyToken(token);
          if (decoded?.adminPreview === true && decoded.publicId === video.publicId) {
            isAdminPreview = true;
          }
        } catch {}
      }

      if (!isAdminPreview) {
        // Token validation
        if (secSettings?.tokenRequired !== false) {
          if (!token) return res.status(401).json({ message: "Token required" });
          const dbToken = await storage.getTokenByValue(token);
          if (!dbToken) {
            const decoded = verifyToken(token);
            if (!decoded || decoded.publicId !== video.publicId) {
              return res.status(401).json({ message: "Invalid token" });
            }
          } else {
            if (dbToken.revoked) return res.status(401).json({ message: "Token revoked" });
            if (dbToken.expiresAt && new Date(dbToken.expiresAt) < new Date()) {
              return res.status(401).json({ message: "Token expired" });
            }
            if (dbToken.videoId !== video.id) return res.status(401).json({ message: "Token mismatch" });
          }
        }

        // Domain check
        if (secSettings?.domainWhitelistEnabled && secSettings.allowedDomains?.length) {
          const referer = req.headers.referer || req.headers.origin || req.headers["x-embed-referrer"] as string || "";
          let domain = "";
          try { domain = new URL(referer).hostname; } catch {}
          if (domain && !secSettings.allowedDomains.includes(domain)) {
            return res.status(403).json({ message: "Domain not allowed" });
          }
        }
      }

      // Direct external m3u8 (admin-provided HLS stream URL)
      const isDirectM3u8 = video.sourceType === "direct_url" && video.sourceUrl && /\.m3u8/i.test(video.sourceUrl);
      if (isDirectM3u8) {
        return res.json({ manifestUrl: video.sourceUrl, sourceType: "hls", videoId: video.id });
      }

      // If no HLS prefix at all, return structured 409 so the frontend can show a fix action
      if (!video.hlsS3Prefix) {
        return res.status(409).json({
          code: "HLS_NOT_AVAILABLE",
          message: "HLS has not been generated for this video yet. Go to the video settings and click 'Build HLS from Source' to convert it.",
        });
      }

      // S3-based HLS
      const client = await getS3Client();
      const cfg = await getS3Config();
      const hlsPrefix = video.hlsS3Prefix;

      if (client && cfg.bucket) {
        const masterKey = `${hlsPrefix}master.m3u8`;
        const ttl = secSettings?.signedUrlTtl || 120;
        const signedMasterUrl = await generateSignedS3Url(masterKey, ttl);
        return res.json({ manifestUrl: signedMasterUrl, sourceType: "s3" });
      }

      // Local HLS fallback
      const localHlsDir = video.hlsS3Prefix;
      const masterPath = path.join(localHlsDir, "master.m3u8");
      if (!fs.existsSync(masterPath)) {
        return res.status(409).json({ code: "HLS_NOT_AVAILABLE", message: "HLS files not found on disk. Re-upload the video or use Build HLS from Source." });
      }

      return res.json({
        manifestUrl: `/api/player/${video.publicId}/hls/master.m3u8?token=${token}`,
        sourceType: "local",
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Serve local HLS files (Express 5 wildcard via app.use)
  app.use("/api/player/:publicId/hls", async (req: any, res: any, next: any) => {
    const video = await storage.getVideoByPublicId(req.params.publicId);
    if (!video) return next();

    const filePath = req.path.replace(/^\//, "");
    if (!filePath) return next();
    const localHlsDir = video.hlsS3Prefix || path.join(uploadDir, "hls", video.id);
    const fullPath = path.resolve(localHlsDir, filePath);

    if (!fullPath.startsWith(path.resolve(localHlsDir)) || !fs.existsSync(fullPath)) {
      return res.status(404).json({ message: "File not found" });
    }

    const ext = path.extname(fullPath);
    const contentType = ext === ".m3u8" ? "application/vnd.apple.mpegurl" : "video/MP2T";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    fs.createReadStream(fullPath).pipe(res);
  });

  // Player settings (public - for embed player to configure itself)
  app.get("/api/player/:publicId/settings", async (req, res) => {
    const video = await storage.getVideoByPublicId(req.params.publicId);
    if (!video) return res.status(404).json({ message: "Not found" });
    const playerSettings = await storage.getPlayerSettings(video.id);
    const watermarkSettings = await storage.getWatermarkSettings(video.id);
    res.json({ playerSettings, watermarkSettings });
  });

  // Playback ping
  app.post("/api/player/:publicId/ping", async (req, res) => {
    try {
      const { sessionCode, secondsWatched } = req.body;
      if (sessionCode) {
        await storage.pingSession(sessionCode, secondsWatched || 0);
      } else {
        // Create new session
        const video = await storage.getVideoByPublicId(req.params.publicId);
        if (video) {
          const code = nanoid(16);
          const domain = req.headers["x-embed-referrer"] as string || req.headers.referer || "";
          let domainHost = "";
          try { domainHost = new URL(domain).hostname; } catch {}
          const session = await storage.createSession({
            videoId: video.id,
            sessionCode: code,
            domain: domainHost,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
          });
          return res.json({ sessionCode: code });
        }
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Analytics ─────────────────────────────────────────────
  app.get("/api/videos/:id/analytics", requireAuth, async (req, res) => {
    const analytics = await storage.getVideoAnalytics(req.params.id);
    res.json(analytics);
  });

  app.get("/api/videos/:id/sessions", requireAuth, async (req, res) => {
    const sessions = await storage.getSessionsByVideo(req.params.id);
    res.json(sessions);
  });

  // ── Audit ─────────────────────────────────────────────────
  app.get("/api/audit", requireAuth, async (req, res) => {
    const logs = await storage.getAuditLogs();
    res.json(logs);
  });

  // ── System Settings ───────────────────────────────────────
  app.get("/api/settings", requireAuth, async (req, res) => {
    const settings = await storage.getAllSettings();
    // Mask secrets in response
    const masked = settings.map(s => {
      if (s.key === "aws_secret_access_key" && s.value) {
        return { ...s, value: "•".repeat(s.value.length) };
      }
      return s;
    });
    res.json(masked);
  });

  app.put("/api/settings", requireAuth, async (req, res) => {
    try {
      const updates = req.body as Record<string, string>;
      await storage.setSettings(updates);
      await storage.createAuditLog({ action: "settings_updated", meta: { keys: Object.keys(updates) }, ip: req.ip });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/settings/:key", requireAuth, async (req, res) => {
    await storage.setSetting(req.params.key, req.body.value);
    res.json({ ok: true });
  });

  // ── Dashboard Stats ───────────────────────────────────────
  app.get("/api/dashboard", requireAuth, async (req, res) => {
    const vids = await storage.getVideos();
    const tokens = await storage.getAllTokens();
    const logs = await storage.getAuditLogs();
    res.json({
      totalVideos: vids.length,
      readyVideos: vids.filter(v => v.status === "ready").length,
      processingVideos: vids.filter(v => v.status === "processing").length,
      totalTokens: tokens.length,
      activeTokens: tokens.filter(t => !t.revoked && (!t.expiresAt || new Date(t.expiresAt) > new Date())).length,
      recentActivity: logs.slice(0, 5),
    });
  });

  return httpServer;
}
