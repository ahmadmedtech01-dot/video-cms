import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearch } from "wouter";
import Hls from "hls.js";

interface WatermarkSettings {
  logoEnabled?: boolean;
  logoUrl?: string;
  logoPosition?: string;
  logoOpacity?: number;
  tickerEnabled?: boolean;
  tickerText?: string;
  tickerSpeed?: number;
  tickerOpacity?: number;
  popEnabled?: boolean;
  popInterval?: number;
  popDuration?: number;
  popMode?: string;
  popOpacity?: number;
  popText?: string;
}

interface PlayerSettings {
  allowSpeed?: boolean;
  allowQuality?: boolean;
  allowFullscreen?: boolean;
  allowSkip?: boolean;
  allowBrightness?: boolean;
  resumeEnabled?: boolean;
  autoplayAllowed?: boolean;
  startTime?: number;
  endTime?: number;
}


const POSITION_CLASSES: Record<string, string> = {
  "top-left": "top-3 left-3",
  "top-right": "top-3 right-3",
  "bottom-left": "bottom-12 left-3",
  "bottom-right": "bottom-12 right-3",
  "center": "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
};

const POP_POSITIONS = ["top-3 left-3", "top-3 right-3", "bottom-12 left-3", "bottom-12 right-3", "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"];

function resolveWatermarkText(template: string, videoId: string, sessionCode: string): string {
  const now = new Date().toLocaleTimeString();
  const domain = document.referrer ? new URL(document.referrer).hostname : window.location.hostname;
  return (template || "")
    .replace("{DOMAIN}", domain)
    .replace("{VIDEO_ID}", videoId)
    .replace("{SESSION_CODE}", sessionCode)
    .replace("{TIME}", now);
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function EmbedPlayerPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") || "";

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const popIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const controlsTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unavailable" | "processing">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [qualities, setQualities] = useState<{ height: number; index: number }[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [sessionCode, setSessionCode] = useState("");
  const [secondsWatched, setSecondsWatched] = useState(0);
  const [popVisible, setPopVisible] = useState(false);
  const [popPosition, setPopPosition] = useState("top-3 right-3");
  const [playerSettings, setPlayerSettings] = useState<PlayerSettings>({});
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettings>({});
  const [videoId, setVideoId] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tickerOffset, setTickerOffset] = useState(0);
  const [playbackDenied, setPlaybackDenied] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const retryPlayback = () => {
    setPlaybackDenied(false);
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setStatus("loading");
    setRetryKey(k => k + 1);
  };

  // Initialize player
  useEffect(() => {
    const init = async () => {
      try {
        // Fetch manifest
        const qs = token ? `?token=${encodeURIComponent(token)}` : "";
        const referrer = document.referrer;
        const manifestRes = await fetch(`/api/player/${publicId}/manifest${qs}`, {
          headers: referrer ? { "x-embed-referrer": referrer } : {},
        });

        if (manifestRes.status === 202) {
          setStatus("processing");
          return;
        }

        if (!manifestRes.ok) {
          const data = await manifestRes.json().catch(() => ({}));
          if (manifestRes.status === 503) { setStatus("unavailable"); return; }
          if (manifestRes.status === 403) { setStatus("unavailable"); setErrorMsg(data.message || "Access denied"); return; }
          if (manifestRes.status === 409 && data.code === "HLS_NOT_AVAILABLE") {
            setStatus("error");
            setErrorMsg("HLS not available — this video has not been converted for our custom player yet. An admin needs to build the HLS from the video source.");
            return;
          }
          setStatus("error");
          setErrorMsg(data.message || "Failed to load video");
          return;
        }

        const data = await manifestRes.json();
        setVideoId(data.videoId || publicId);

        // Fetch video settings
        try {
          const settingsRes = await fetch(`/api/player/${publicId}/settings${qs}`);
          if (settingsRes.ok) {
            const s = await settingsRes.json();
            setPlayerSettings(s.playerSettings || {});
            setWatermarkSettings(s.watermarkSettings || {});
          }
        } catch {}

        // Start session ping
        const pingRes = await fetch(`/api/player/${publicId}/ping`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(referrer ? { "x-embed-referrer": referrer } : {}) },
          body: JSON.stringify({}),
        });
        if (pingRes.ok) {
          const pingData = await pingRes.json();
          if (pingData.sessionCode) setSessionCode(pingData.sessionCode);
        }

        const manifestUrl = data.manifestUrl;
        if (!manifestUrl) { setStatus("error"); setErrorMsg("No manifest URL"); return; }

        if (!videoRef.current) return;
        const video = videoRef.current;

        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
          hlsRef.current = hls;
          hls.loadSource(manifestUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, (_, hlsData) => {
            setQualities(hlsData.levels.map((l, i) => ({ height: l.height, index: i })));
            setStatus("ready");
            if (playerSettings.autoplayAllowed) video.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_, d) => {
            if (d.fatal) {
              const code = (d as any).response?.code;
              if (code === 403 || code === 401) {
                // Session revoked or expired — show PLAYBACK_DENIED overlay
                hls.stopLoad();
                videoRef.current?.pause();
                setPlaybackDenied(true);
              } else {
                setStatus("error");
                setErrorMsg("Stream error");
              }
            }
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = manifestUrl;
          video.addEventListener("loadedmetadata", () => setStatus("ready"));
        } else {
          setStatus("error");
          setErrorMsg("HLS not supported in this browser");
        }
      } catch (e: any) {
        setStatus("error");
        setErrorMsg(e.message || "Failed to load");
      }
    };

    init();

    return () => {
      hlsRef.current?.destroy();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (popIntervalRef.current) clearInterval(popIntervalRef.current);
    };
  }, [publicId, token, retryKey]);

  // Ping interval
  useEffect(() => {
    if (!sessionCode) return;
    pingIntervalRef.current = setInterval(() => {
      fetch(`/api/player/${publicId}/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionCode, secondsWatched }),
      }).catch(() => {});
    }, 30000);
    return () => { if (pingIntervalRef.current) clearInterval(pingIntervalRef.current); };
  }, [sessionCode, secondsWatched, publicId]);

  // Ticker animation
  useEffect(() => {
    if (!watermarkSettings.tickerEnabled) return;
    const speed = watermarkSettings.tickerSpeed || 50;
    const interval = setInterval(() => {
      setTickerOffset(prev => prev - (speed / 60));
    }, 16);
    return () => clearInterval(interval);
  }, [watermarkSettings.tickerEnabled, watermarkSettings.tickerSpeed]);

  // Pop watermark
  useEffect(() => {
    if (!watermarkSettings.popEnabled) return;
    const interval = (watermarkSettings.popInterval || 30) * 1000;
    popIntervalRef.current = setInterval(() => {
      const mode = watermarkSettings.popMode || "random";
      let pos: string;
      if (mode === "center") pos = POP_POSITIONS[4];
      else if (mode === "corners") pos = POP_POSITIONS[Math.floor(Math.random() * 4)];
      else pos = POP_POSITIONS[Math.floor(Math.random() * POP_POSITIONS.length)];
      setPopPosition(pos);
      setPopVisible(true);
      setTimeout(() => setPopVisible(false), (watermarkSettings.popDuration || 3) * 1000);
    }, interval);
    return () => { if (popIntervalRef.current) clearInterval(popIntervalRef.current); };
  }, [watermarkSettings.popEnabled, watermarkSettings.popInterval, watermarkSettings.popDuration, watermarkSettings.popMode]);

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (playing) setSecondsWatched(s => s + 0.25);
    };
    const onDuration = () => setDuration(video.duration);
    const onVolumeChange = () => { setVolume(video.volume); setMuted(video.muted); };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("volumechange", onVolumeChange);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("volumechange", onVolumeChange);
    };
  }, [playing]);

  // Controls auto-hide
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  };

  const seek = (delta: number) => {
    const v = videoRef.current;
    if (!v || !playerSettings.allowSkip) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
  };

  const handleSeekBar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v || !playerSettings.allowSkip) return;
    v.currentTime = parseFloat(e.target.value);
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const vol = parseFloat(e.target.value);
    v.volume = vol;
    v.muted = vol === 0;
  };

  const toggleFullscreen = () => {
    if (!playerSettings.allowFullscreen) return;
    const el = playerContainerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  const changeSpeed = (rate: number) => {
    const v = videoRef.current;
    if (!v || !playerSettings.allowSpeed) return;
    v.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const changeQuality = (index: number) => {
    const hls = hlsRef.current;
    if (!hls || !playerSettings.allowQuality) return;
    hls.currentLevel = index;
    setCurrentQuality(index);
  };

  if (status === "unavailable") {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <div className="text-center space-y-2">
          <div className="text-4xl">🔒</div>
          <p className="text-lg font-semibold">{errorMsg || "Video Unavailable"}</p>
          <p className="text-sm opacity-60">This video is not available for playback.</p>
        </div>
      </div>
    );
  }

  if (status === "processing") {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white border-t-transparent mx-auto" />
          <p className="text-lg font-semibold">Processing Video</p>
          <p className="text-sm opacity-60">Your video is being ingested and converted to HLS. Please check back in a few minutes.</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <div className="text-center space-y-2 max-w-sm px-4">
          <div className="text-4xl">⚠️</div>
          <p className="text-lg font-semibold">Playback Error</p>
          <p className="text-sm opacity-60">{errorMsg || "Could not load video."}</p>
        </div>
      </div>
    );
  }

  const ws = watermarkSettings;
  const tickerText = resolveWatermarkText(ws.tickerText || "", videoId, sessionCode);
  const popText = resolveWatermarkText(ws.popText || "{DOMAIN}", videoId, sessionCode);

  return (
    <div className="bg-black w-full h-screen flex items-center justify-center overflow-hidden">
      <div
        ref={playerContainerRef}
        className="relative w-full h-full select-none"
        onMouseMove={showControlsTemporarily}
        onMouseLeave={() => playing && setShowControls(false)}
        onClick={togglePlay}
      >
          {/* Video Element */}
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            style={{ filter: `brightness(${brightness}%)` }}
            playsInline
            preload="metadata"
          />

          {/* Loading overlay */}
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
            </div>
          )}

          {/* Playback Denied overlay */}
          {playbackDenied && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/85 z-50" data-testid="overlay-playback-denied">
              <div className="text-center space-y-4 px-6 max-w-sm">
                <div className="text-5xl select-none">🛡️</div>
                <p className="text-white text-base font-semibold leading-snug">
                  Video playback denied due to suspicious activity.
                </p>
                <p className="text-white/60 text-sm">
                  Too many requests were detected. Please wait a moment and try again.
                </p>
                <button
                  onClick={e => { e.stopPropagation(); retryPlayback(); }}
                  className="mt-2 px-5 py-2 rounded-md bg-white text-black text-sm font-medium hover:bg-white/90 transition-colors"
                  data-testid="button-retry-playback"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Logo Watermark */}
          {ws.logoEnabled && ws.logoUrl && (
            <div
              className={`absolute pointer-events-none ${POSITION_CLASSES[ws.logoPosition || "top-right"]}`}
              style={{ opacity: ws.logoOpacity ?? 0.8 }}
            >
              <img src={ws.logoUrl} alt="" className="h-8 max-w-[120px] object-contain" />
            </div>
          )}

          {/* Ticker */}
          {ws.tickerEnabled && ws.tickerText && (
            <div
              className="absolute bottom-12 left-0 right-0 overflow-hidden pointer-events-none"
              style={{ opacity: ws.tickerOpacity ?? 0.7 }}
            >
              <div
                className="whitespace-nowrap text-white text-sm font-medium py-0.5 px-2 bg-black/40"
                style={{ transform: `translateX(${tickerOffset % (tickerText.length * 12 + 800)}px)` }}
              >
                {tickerText} &nbsp;&nbsp;&nbsp;&nbsp;{tickerText}
              </div>
            </div>
          )}

          {/* Pop Watermark */}
          {ws.popEnabled && popVisible && (
            <div
              className={`absolute pointer-events-none text-white text-sm font-semibold px-2 py-1 rounded bg-black/50 ${popPosition}`}
              style={{ opacity: ws.popOpacity ?? 0.8 }}
            >
              {popText}
            </div>
          )}

          {/* Controls Overlay */}
          <div
            className={`absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-transparent to-transparent transition-opacity duration-300 ${showControls || !playing ? "opacity-100" : "opacity-0"}`}
            onClick={e => e.stopPropagation()}
          >
            {/* Seek Bar */}
            {(playerSettings.allowSkip !== false) && (
              <div className="px-3 pb-1">
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeekBar}
                  className="w-full h-1 cursor-pointer accent-white"
                />
              </div>
            )}

            {/* Controls Bar */}
            <div className="flex items-center gap-2 px-3 pb-3 flex-wrap">
              {/* Play/Pause */}
              <button onClick={togglePlay} className="text-white hover:text-white/80 shrink-0 p-1">
                {playing ? (
                  <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                ) : (
                  <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
                )}
              </button>

              {/* Skip -10 */}
              {playerSettings.allowSkip !== false && (
                <>
                  <button onClick={() => seek(-10)} className="text-white text-xs hover:text-white/80 shrink-0 p-1">-10</button>
                  <button onClick={() => seek(10)} className="text-white text-xs hover:text-white/80 shrink-0 p-1">+10</button>
                </>
              )}

              {/* Time */}
              <span className="text-white text-xs shrink-0">{formatTime(currentTime)} / {formatTime(duration)}</span>

              <div className="flex-1" />

              {/* Volume */}
              <div className="flex items-center gap-1">
                <button onClick={() => { const v = videoRef.current; if (v) v.muted = !v.muted; }} className="text-white p-1">
                  {muted || volume === 0 ? (
                    <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                  ) : (
                    <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                  )}
                </button>
                <input
                  type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
                  onChange={handleVolume}
                  className="w-16 h-1 cursor-pointer accent-white"
                />
              </div>

              {/* Brightness */}
              {playerSettings.allowBrightness !== false && (
                <input
                  type="range" min={30} max={150} step={5} value={brightness}
                  onChange={e => setBrightness(parseInt(e.target.value))}
                  className="w-16 h-1 cursor-pointer accent-white"
                  title="Brightness"
                />
              )}

              {/* Speed */}
              {playerSettings.allowSpeed !== false && (
                <select
                  value={playbackRate}
                  onChange={e => changeSpeed(parseFloat(e.target.value))}
                  className="bg-black/60 text-white text-xs rounded px-1 py-0.5 border border-white/20"
                >
                  {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map(r => (
                    <option key={r} value={r}>{r}x</option>
                  ))}
                </select>
              )}

              {/* Quality */}
              {playerSettings.allowQuality !== false && qualities.length > 1 && (
                <select
                  value={currentQuality}
                  onChange={e => changeQuality(parseInt(e.target.value))}
                  className="bg-black/60 text-white text-xs rounded px-1 py-0.5 border border-white/20"
                >
                  <option value={-1}>Auto</option>
                  {qualities.map(q => <option key={q.index} value={q.index}>{q.height}p</option>)}
                </select>
              )}

              {/* Fullscreen */}
              {playerSettings.allowFullscreen !== false && (
                <button onClick={toggleFullscreen} className="text-white hover:text-white/80 p-1">
                  {isFullscreen ? (
                    <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
                  ) : (
                    <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
    </div>
  );
}
