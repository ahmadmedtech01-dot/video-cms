import crypto from "crypto";

function resolveSecret(): string {
  if (process.env.SIGNING_SECRET) return process.env.SIGNING_SECRET;
  if (process.env.SESSION_SECRET) {
    return crypto.createHash("sha256").update("vcms-video-signing:" + process.env.SESSION_SECRET).digest("hex");
  }
  console.warn("[video-session] WARNING: No SIGNING_SECRET or SESSION_SECRET set — playback security degraded");
  return "insecure-dev-only-signing-key";
}

const SECRET = resolveSecret();

// Abuse signal thresholds
const ABUSE_THRESHOLDS = {
  requestsPerWindow: 25,       // max requests per 5s window
  requestWindowMs: 5000,
  concurrentSegments: 6,       // max simultaneous segment requests per session
  playlistFetchesPerMin: 12,   // max playlist fetches per 60s (repeated reload = abuse)
  keyHitsPerMin: 8,            // max key requests per 60s
  scoreToRevoke: 10,           // revoke when abuseScore reaches this
};

export interface AbuseReason {
  signal: "rate_limit" | "concurrent" | "playlist_abuse" | "key_abuse" | "ip_mismatch";
  detail: string;
}

export interface VideoSession {
  publicId: string;
  hlsPrefix: string;
  storageProvider: "backblaze_b2" | "s3" | "local";
  storageConfig: any;
  connId: string | null;
  createdAt: number;
  revoked: boolean;
  revokeReason: AbuseReason | null;
  abuseScore: number;

  // Rate limiting
  requestLog: number[];

  // Concurrent segment tracking
  concurrentSegments: number;

  // Playlist fetch tracking (to detect repeated playlist abuse)
  playlistFetchLog: number[];

  // Key endpoint hit tracking
  keyHitLog: number[];

  // IP binding (first IP wins; subsequent different IPs are flagged)
  boundIp: string | null;
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
    revokeReason: null,
    abuseScore: 0,
    requestLog: [],
    concurrentSegments: 0,
    playlistFetchLog: [],
    keyHitLog: [],
    boundIp: null,
  });
  return sid;
}

export function getSession(sid: string): VideoSession | undefined {
  return sessions.get(sid);
}

export function revokeSession(sid: string, reason?: AbuseReason): void {
  const s = sessions.get(sid);
  if (s) {
    s.revoked = true;
    if (reason) s.revokeReason = reason;
  }
}

export function signPath(sid: string, resourcePath: string, exp: number): string {
  const payload = `${sid}|${resourcePath}|${exp}`;
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function verifySignedPath(sid: string, resourcePath: string, exp: number, st: string): boolean {
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

function addAbuse(s: VideoSession, delta: number, reason: AbuseReason): { abused: boolean } {
  s.abuseScore += delta;
  if (s.abuseScore >= ABUSE_THRESHOLDS.scoreToRevoke) {
    s.revoked = true;
    if (!s.revokeReason) s.revokeReason = reason;
    return { abused: true };
  }
  return { abused: false };
}

// ── Signal 1: General request rate ───────────────────────────────────────────
export function trackRequest(sid: string, ip?: string): { abused: boolean; reason?: AbuseReason } {
  const s = sessions.get(sid);
  if (!s) return { abused: true, reason: { signal: "rate_limit", detail: "Session not found" } };
  if (s.revoked) return { abused: true, reason: s.revokeReason ?? { signal: "rate_limit", detail: "Session revoked" } };

  // IP binding check — bind first IP seen; flag if a different IP uses same session
  if (ip) {
    if (!s.boundIp) {
      s.boundIp = ip;
    } else if (s.boundIp !== ip) {
      const reason: AbuseReason = { signal: "ip_mismatch", detail: `Session used from multiple IPs (${s.boundIp} → ${ip})` };
      return addAbuse(s, 8, reason);
    }
  }

  // Rate window
  const now = Date.now();
  s.requestLog = s.requestLog.filter(t => t > now - ABUSE_THRESHOLDS.requestWindowMs);
  s.requestLog.push(now);

  if (s.requestLog.length > ABUSE_THRESHOLDS.requestsPerWindow) {
    const reason: AbuseReason = { signal: "rate_limit", detail: `${s.requestLog.length} requests in 5s (limit: ${ABUSE_THRESHOLDS.requestsPerWindow})` };
    return addAbuse(s, 5, reason);
  }

  return { abused: false };
}

// ── Signal 2: Playlist fetch abuse ───────────────────────────────────────────
export function trackPlaylistFetch(sid: string, ip?: string): { abused: boolean; reason?: AbuseReason } {
  const base = trackRequest(sid, ip);
  if (base.abused) return base;

  const s = sessions.get(sid)!;
  const now = Date.now();
  s.playlistFetchLog = s.playlistFetchLog.filter(t => t > now - 60000);
  s.playlistFetchLog.push(now);

  if (s.playlistFetchLog.length > ABUSE_THRESHOLDS.playlistFetchesPerMin) {
    const reason: AbuseReason = { signal: "playlist_abuse", detail: `${s.playlistFetchLog.length} playlist fetches in 60s (limit: ${ABUSE_THRESHOLDS.playlistFetchesPerMin})` };
    return addAbuse(s, 3, reason);
  }

  return { abused: false };
}

// ── Signal 3: Concurrent segment connections ──────────────────────────────────
export function acquireSegment(sid: string, ip?: string): { abused: boolean; reason?: AbuseReason } {
  const base = trackRequest(sid, ip);
  if (base.abused) return base;

  const s = sessions.get(sid)!;
  s.concurrentSegments += 1;

  if (s.concurrentSegments > ABUSE_THRESHOLDS.concurrentSegments) {
    const reason: AbuseReason = { signal: "concurrent", detail: `${s.concurrentSegments} concurrent segment requests (limit: ${ABUSE_THRESHOLDS.concurrentSegments})` };
    // Decrement back since we won't serve this
    s.concurrentSegments -= 1;
    return addAbuse(s, 5, reason);
  }

  return { abused: false };
}

export function releaseSegment(sid: string): void {
  const s = sessions.get(sid);
  if (s && s.concurrentSegments > 0) s.concurrentSegments -= 1;
}

// ── Signal 4: Encryption key endpoint hits ────────────────────────────────────
export function trackKeyHit(sid: string, ip?: string): { abused: boolean; reason?: AbuseReason } {
  const base = trackRequest(sid, ip);
  if (base.abused) return base;

  const s = sessions.get(sid)!;
  const now = Date.now();
  s.keyHitLog = s.keyHitLog.filter(t => t > now - 60000);
  s.keyHitLog.push(now);

  if (s.keyHitLog.length > ABUSE_THRESHOLDS.keyHitsPerMin) {
    const reason: AbuseReason = { signal: "key_abuse", detail: `${s.keyHitLog.length} key requests in 60s (limit: ${ABUSE_THRESHOLDS.keyHitsPerMin})` };
    return addAbuse(s, 5, reason);
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

// Snapshot of session abuse state for debugging/logging
export function getSessionAbuseSummary(sid: string) {
  const s = sessions.get(sid);
  if (!s) return null;
  return {
    sid,
    publicId: s.publicId,
    revoked: s.revoked,
    revokeReason: s.revokeReason,
    abuseScore: s.abuseScore,
    concurrentSegments: s.concurrentSegments,
    recentRequests: s.requestLog.length,
    playlistFetches: s.playlistFetchLog.length,
    keyHits: s.keyHitLog.length,
    boundIp: s.boundIp,
  };
}
