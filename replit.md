# Secure Video CMS

A full-stack secure video content management system for a single admin user.

## Architecture

**Full-stack monorepo** — Express backend + React frontend (served on same port via Vite proxy in dev).

- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui + TanStack Query + Wouter
- **Backend**: Node.js + Express 5 (TypeScript)
- **Database**: PostgreSQL via Drizzle ORM
- **Storage**: Backblaze B2 (S3-Compatible, primary) + AWS S3 (legacy) + local fallback — managed via Storage Connections in System Settings
- **Video Processing**: ffmpeg for HLS transcoding (when available)
- **Auth**: Session-based (express-session + connect-pg-simple)

## Features

### Admin Panel
- **Login**: Email/password auth with session management
- **Dashboard**: Stats overview, recent activity, quick actions
- **Video Library**: List/search/manage all videos with status badges
- **Upload Wizard**: File upload to S3 + HLS transcoding, OR URL import (YouTube/Vimeo/Drive/OneDrive/S3/Direct)
- **Video Detail** (tabbed):
  - Overview: metadata editing
  - Player: controls configuration (speed, quality, fullscreen, skip, brightness, resume, autoplay)
  - Watermark: logo, scrolling ticker, pop-up watermark with variable templates
  - Security: token required, signed URLs, domain whitelist, referrer checks, concurrent limits
  - Embed & Share: iframe code, masked share link, token management
  - Analytics: plays, watch time, top domains, recent sessions
  - Tokens: create/revoke/delete embed tokens
- **Embed Manager**: Global view of all tokens across videos
- **Audit Logs**: Full admin action history
- **System Settings**: Storage Connections (B2 + S3), Vimeo integration, AWS/S3 legacy config, global kill switch, signing secret, ffmpeg toggle

### Public Pages
- `/embed/:publicId?token=...` — iframe-embeddable HLS player
- `/v/:publicId?token=...` — masked share link page
- Both support: hls.js playback, watermark overlays, token validation, domain checking

## Database Tables

- `admin_users` — single admin account
- `videos` — video metadata, status, S3 keys
- `video_player_settings` — per-video player config
- `video_watermark_settings` — logo, ticker, pop-up watermark
- `video_security_settings` — token, domain, signed URL config
- `embed_tokens` — JWT tokens with expiry and domain restriction
- `playback_sessions` — analytics sessions
- `audit_logs` — admin action log
- `system_settings` — key-value config store (AWS, kill switch, Vimeo token, etc.)
- `storage_connections` — named storage providers (Backblaze B2 / AWS S3) with config + active flag
- `user_sessions` — express session store

## Key API Routes

### Auth
- `POST /api/auth/login` — Login with email/password
- `POST /api/auth/logout` — Logout
- `GET /api/auth/me` — Check session

### Videos
- `GET/POST /api/videos` — List/create videos
- `GET/PUT/DELETE /api/videos/:id` — Get/update/delete video
- `POST /api/videos/:id/upload` — Upload video file (multipart)
- `PUT /api/videos/:id/player-settings` — Update player config
- `PUT /api/videos/:id/watermark-settings` — Update watermark config
- `PUT /api/videos/:id/security-settings` — Update security config
- `POST /api/videos/:id/toggle-availability` — Show/hide video
- `GET /api/videos/:id/analytics` — Analytics data
- `POST /api/videos/:id/tokens` — Create embed token

### Player (Public)
- `GET /api/player/:publicId/manifest` — Get signed HLS manifest URL
- `GET /api/player/:publicId/settings` — Get player/watermark settings
- `POST /api/player/:publicId/ping` — Update playback session

### System
- `GET/PUT /api/settings` — Get/update system settings
- `GET /api/audit` — Get audit logs
- `GET /api/dashboard` — Dashboard stats

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned)
- `SESSION_SECRET` — Session encryption secret
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — Seeded admin credentials
- `SIGNING_SECRET` — JWT signing secret for embed tokens
- `VIMEO_ACCESS_TOKEN` — Vimeo Personal Access Token (or set via System Settings)
- `B2_KEY_ID` — Backblaze B2 Application Key ID (required for B2 uploads)
- `B2_APPLICATION_KEY` — Backblaze B2 Application Key secret (required for B2 uploads)
- `B2_S3_ENDPOINT` — B2 S3-compatible endpoint (e.g. `https://s3.ca-east-006.backblazeb2.com`)
- `B2_BUCKET` — Default B2 bucket name (e.g. `mytestvideo`)

## Storage Configuration

The system supports two storage backends managed via System Settings → Storage Connections:

1. **Backblaze B2 (S3-Compatible)** — Recommended. Requires `B2_KEY_ID` and `B2_APPLICATION_KEY` in Replit Secrets. Non-secret config (endpoint, bucket, prefixes) stored in `storage_connections` table.
2. **AWS S3** — Legacy. Credentials stored in `system_settings` key-value store.
3. **Local fallback** — When no cloud storage is configured, files stored on local disk (not persistent between restarts).

The active connection is selected per connection card in System Settings. New uploads and HLS outputs automatically use the active connection. The manifest endpoint signs URLs using the connection associated with each video.

The system supports these video source types:
- **upload** — Direct file upload → S3 → ffmpeg HLS
- **youtube** — YouTube embed URL
- **vimeo** — Vimeo embed URL
- **drive** — Google Drive URL
- **onedrive** — OneDrive URL
- **s3** — Direct S3 URL
- **direct** — Any direct video URL

## Run Instructions

1. Start via "Start application" workflow — runs `npm run dev`
2. Access admin at `http://localhost:5000`
3. Login with configured admin credentials
4. Configure AWS in System Settings if using S3 uploads
5. Upload or import videos
6. Generate embed tokens and use the iframe/share codes on external sites
