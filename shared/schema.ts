import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  boolean,
  integer,
  real,
  jsonb,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const videos = pgTable("videos", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  publicId: text("public_id").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").default(""),
  author: text("author").default(""),
  tags: text("tags").array().default(sql`'{}'::text[]`),
  thumbnailUrl: text("thumbnail_url"),
  status: text("status").notNull().default("uploading"),
  available: boolean("available").notNull().default(true),
  sourceType: text("source_type").notNull().default("upload"),
  sourceUrl: text("source_url"),
  rawS3Key: text("raw_s3_key"),
  hlsS3Prefix: text("hls_s3_prefix"),
  qualities: integer("qualities").array().default(sql`'{}'::int[]`),
  duration: integer("duration"),
  fileSize: integer("file_size"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const videoPlayerSettings = pgTable("video_player_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: uuid("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  allowSpeed: boolean("allow_speed").notNull().default(true),
  allowQuality: boolean("allow_quality").notNull().default(true),
  allowFullscreen: boolean("allow_fullscreen").notNull().default(true),
  allowSkip: boolean("allow_skip").notNull().default(true),
  allowBrightness: boolean("allow_brightness").notNull().default(true),
  resumeEnabled: boolean("resume_enabled").notNull().default(true),
  autoplayAllowed: boolean("autoplay_allowed").notNull().default(false),
  startTime: integer("start_time").notNull().default(0),
  endTime: integer("end_time"),
});

export const videoWatermarkSettings = pgTable("video_watermark_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: uuid("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  logoEnabled: boolean("logo_enabled").notNull().default(false),
  logoUrl: text("logo_url"),
  logoPosition: text("logo_position").notNull().default("top-right"),
  logoOpacity: real("logo_opacity").notNull().default(0.8),
  tickerEnabled: boolean("ticker_enabled").notNull().default(false),
  tickerText: text("ticker_text").default(""),
  tickerSpeed: integer("ticker_speed").notNull().default(50),
  tickerOpacity: real("ticker_opacity").notNull().default(0.7),
  popEnabled: boolean("pop_enabled").notNull().default(false),
  popInterval: integer("pop_interval").notNull().default(30),
  popDuration: integer("pop_duration").notNull().default(3),
  popMode: text("pop_mode").notNull().default("random"),
  popOpacity: real("pop_opacity").notNull().default(0.8),
  popText: text("pop_text").default("{DOMAIN}"),
});

export const videoSecuritySettings = pgTable("video_security_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: uuid("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  signedUrls: boolean("signed_urls").notNull().default(true),
  signedUrlTtl: integer("signed_url_ttl").notNull().default(120),
  domainWhitelistEnabled: boolean("domain_whitelist_enabled").notNull().default(false),
  allowedDomains: text("allowed_domains").array().default(sql`'{}'::text[]`),
  referrerStrict: boolean("referrer_strict").notNull().default(false),
  tokenRequired: boolean("token_required").notNull().default(true),
  tokenTtl: integer("token_ttl").notNull().default(86400),
  concurrentLimit: integer("concurrent_limit").notNull().default(5),
  rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(false),
  hotlinkProtection: boolean("hotlink_protection").notNull().default(true),
  drmMode: boolean("drm_mode").notNull().default(false),
});

export const embedTokens = pgTable("embed_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: uuid("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  label: text("label").default(""),
  allowedDomain: text("allowed_domain"),
  expiresAt: timestamp("expires_at"),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const playbackSessions = pgTable("playback_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: uuid("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  tokenId: uuid("token_id"),
  sessionCode: text("session_code").notNull(),
  domain: text("domain"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  secondsWatched: integer("seconds_watched").notNull().default(0),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  action: text("action").notNull(),
  meta: jsonb("meta"),
  ip: text("ip"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const systemSettings = pgTable("system_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVideoSchema = createInsertSchema(videos).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmbedTokenSchema = createInsertSchema(embedTokens).omit({
  id: true,
  createdAt: true,
  token: true,
});

export type InsertUser = { email: string; passwordHash: string };
export type AdminUser = typeof adminUsers.$inferSelect;
export type Video = typeof videos.$inferSelect;
export type VideoPlayerSettings = typeof videoPlayerSettings.$inferSelect;
export type VideoWatermarkSettings = typeof videoWatermarkSettings.$inferSelect;
export type VideoSecuritySettings = typeof videoSecuritySettings.$inferSelect;
export type EmbedToken = typeof embedTokens.$inferSelect;
export type PlaybackSession = typeof playbackSessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type SystemSetting = typeof systemSettings.$inferSelect;

export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type InsertEmbedToken = z.infer<typeof insertEmbedTokenSchema>;
