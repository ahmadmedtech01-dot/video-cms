import crypto from "crypto";

// Signing secret — use explicit SIGNING_SECRET env, or derive from SESSION_SECRET
function resolveSecret(): string {
  if (process.env.SIGNING_SECRET) return process.env.SIGNING_SECRET;
  if (process.env.SESSION_SECRET) {
    return crypto.createHash("sha256").update("vcms-video-signing:" + process.env.SESSION_SECRET).digest("hex");
  }
  console.warn("[video-session] WARNING: No SIGNING_SECRET or SESSION_SECRET set — playback security degraded");
  return "insecure-dev-only-signing-key";
}

const SECRET = resolveSecret();

export interface VideoSession {
  publicId: string;
  hlsPrefix: string;
  storageProvider: "backblaze_b2" | "s3" | "local";
  storageConfig: any;
  connId: string | null;
  createdAt: number;
  revoked: boolean;
  abuseScore: number;
  requestLog: number[];
}

const sessions = new Map<string, VideoSession>();

// Evict sessions older than 30 minutes every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
}, 5 * 60 * 1000).unref();

export function createSession(
  publicId: string,
  hlsPrefix: string,
  storageProvider: "backblaze_b2" | "s3" | "local",
  storageConfig: any,
  connId: string | null,
): string {
  const sid = crypto.randomBytes(16).toString("hex");
  sessions.set(sid, {
    publicId,
    hlsPrefix,
    storageProvider,
    storageConfig,
    connId,
    createdAt: Date.now(),
    revoked: false,
    abuseScore: 0,
    requestLog: [],
  });
  return sid;
}

export function getSession(sid: string): VideoSession | undefined {
  return sessions.get(sid);
}

export function revokeSession(sid: string): void {
  const s = sessions.get(sid);
  if (s) s.revoked = true;
}

export function signPath(sid: string, resourcePath: string, exp: number): string {
  const payload = `${sid}|${resourcePath}|${exp}`;
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function verifySignedPath(sid: string, resourcePath: string, exp: number, st: string): boolean {
  // Check expiry first
  if (Math.floor(Date.now() / 1000) > exp) return false;
  const expected = signPath(sid, resourcePath, exp);
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(st, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Track request rate — returns { abused: true } if session should be revoked
export function trackRequest(sid: string): { abused: boolean } {
  const s = sessions.get(sid);
  if (!s) return { abused: true };
  if (s.revoked) return { abused: true };

  const now = Date.now();
  s.requestLog = s.requestLog.filter(t => t > now - 5000);
  s.requestLog.push(now);

  // More than 25 requests in a 5-second window = abuse (IDM/bulk downloader pattern)
  if (s.requestLog.length > 25) {
    s.abuseScore += 5;
  }

  if (s.abuseScore >= 10) {
    s.revoked = true;
    return { abused: true };
  }
  return { abused: false };
}

// Build a signed proxy URL with sid/st/exp query params
export function buildSignedProxyUrl(baseUrl: string, sid: string, resourcePath: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const st = signPath(sid, resourcePath, exp);
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}sid=${encodeURIComponent(sid)}&st=${encodeURIComponent(st)}&exp=${exp}`;
}
