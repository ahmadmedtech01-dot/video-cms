import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, Eye, EyeOff, ExternalLink, Copy, CheckCircle, RefreshCw,
  Key, Shield, Droplets, Settings2, BarChart3, ScrollText, Code2,
  Plus, Trash2, AlertCircle, Video, Clock,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { EmbedToken } from "@shared/schema";

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button size="sm" variant="outline" onClick={copy} data-testid="button-copy">
      {copied ? <CheckCircle className="h-3.5 w-3.5 mr-1 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
      {copied ? "Copied!" : (label || "Copy")}
    </Button>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [tokenLabel, setTokenLabel] = useState("Embed Token");
  const [tokenDomain, setTokenDomain] = useState("");
  const [tokenTtl, setTokenTtl] = useState("24");
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [baseUrl, setBaseUrl] = useState(() => window.location.origin);

  const { data: videoData, isLoading } = useQuery({
    queryKey: ["/api/videos", id],
    queryFn: () => fetch(`/api/videos/${id}`).then(r => r.json()),
  });

  const { data: tokens = [], refetch: refetchTokens } = useQuery<EmbedToken[]>({
    queryKey: ["/api/videos", id, "tokens"],
    queryFn: () => fetch(`/api/videos/${id}/tokens`).then(r => r.json()),
  });

  const { data: analytics } = useQuery({
    queryKey: ["/api/videos", id, "analytics"],
    queryFn: () => fetch(`/api/videos/${id}/analytics`).then(r => r.json()),
    enabled: !!videoData,
  });

  const updateVideo = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/videos/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/videos", id] }); toast({ title: "Saved" }); },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const updatePlayer = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/videos/${id}/player-settings`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/videos", id] }); toast({ title: "Player settings saved" }); },
  });

  const updateWatermark = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/videos/${id}/watermark-settings`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/videos", id] }); toast({ title: "Watermark settings saved" }); },
  });

  const updateSecurity = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/videos/${id}/security-settings`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/videos", id] }); toast({ title: "Security settings saved" }); },
  });

  const createToken = useMutation({
    mutationFn: () => apiRequest("POST", `/api/videos/${id}/tokens`, {
      label: tokenLabel, allowedDomain: tokenDomain || null, ttlHours: parseInt(tokenTtl),
    }),
    onSuccess: () => {
      refetchTokens();
      setTokenDialogOpen(false);
      setTokenLabel("Embed Token");
      setTokenDomain("");
      toast({ title: "Token created" });
    },
    onError: () => toast({ title: "Failed to create token", variant: "destructive" }),
  });

  const revokeToken = useMutation({
    mutationFn: (tokenId: string) => apiRequest("POST", `/api/tokens/${tokenId}/revoke`),
    onSuccess: () => { refetchTokens(); toast({ title: "Token revoked" }); },
  });

  const deleteToken = useMutation({
    mutationFn: (tokenId: string) => apiRequest("DELETE", `/api/tokens/${tokenId}`),
    onSuccess: () => { refetchTokens(); toast({ title: "Token deleted" }); },
  });

  const toggle = useMutation({
    mutationFn: () => apiRequest("POST", `/api/videos/${id}/toggle-availability`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/videos", id] }),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!videoData || videoData.message) {
    return (
      <div className="p-6 flex flex-col items-center py-16">
        <AlertCircle className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-foreground font-medium">Video not found</p>
        <Button asChild variant="outline" className="mt-4"><Link href="/library">Back to Library</Link></Button>
      </div>
    );
  }

  const video = videoData;
  const ps = video.playerSettings || {};
  const ws = video.watermarkSettings || {};
  const ss = video.securitySettings || {};
  const firstToken = tokens.find(t => !t.revoked);
  const embedSrc = firstToken
    ? `${baseUrl}/embed/${video.publicId}?token=${firstToken.token}`
    : `${baseUrl}/embed/${video.publicId}`;
  const shareLink = firstToken
    ? `${baseUrl}/v/${video.publicId}?token=${firstToken.token}`
    : `${baseUrl}/v/${video.publicId}`;

  const iframeCode = `<iframe
  src="${embedSrc}"
  width="100%"
  height="500"
  allow="fullscreen"
  referrerpolicy="no-referrer-when-downgrade"
  sandbox="allow-scripts allow-same-origin allow-presentation"
  frameborder="0">
</iframe>`;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button size="icon" variant="ghost" asChild><Link href="/library"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">{video.title}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge variant={video.status === "ready" ? "default" : "secondary"} className="text-xs capitalize">
                {video.status}
              </Badge>
              <Badge variant={video.available ? "outline" : "destructive"} className="text-xs">
                {video.available ? "Available" : "Hidden"}
              </Badge>
              <span className="text-xs text-muted-foreground">{video.publicId}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={`/embed/${video.publicId}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" />Preview
            </a>
          </Button>
          <Button size="sm" variant={video.available ? "outline" : "default"} onClick={() => toggle.mutate()}>
            {video.available ? <><EyeOff className="h-3.5 w-3.5 mr-1" />Hide</> : <><Eye className="h-3.5 w-3.5 mr-1" />Show</>}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" data-testid="tab-overview"><Video className="h-3.5 w-3.5 mr-1" />Overview</TabsTrigger>
          <TabsTrigger value="player" data-testid="tab-player"><Settings2 className="h-3.5 w-3.5 mr-1" />Player</TabsTrigger>
          <TabsTrigger value="watermark" data-testid="tab-watermark"><Droplets className="h-3.5 w-3.5 mr-1" />Watermark</TabsTrigger>
          <TabsTrigger value="security" data-testid="tab-security"><Shield className="h-3.5 w-3.5 mr-1" />Security</TabsTrigger>
          <TabsTrigger value="embed" data-testid="tab-embed"><Code2 className="h-3.5 w-3.5 mr-1" />Embed & Share</TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics"><BarChart3 className="h-3.5 w-3.5 mr-1" />Analytics</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit"><ScrollText className="h-3.5 w-3.5 mr-1" />Tokens</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card className="border border-card-border">
            <CardHeader><CardTitle className="text-base">Video Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input defaultValue={video.title} onBlur={e => updateVideo.mutate({ title: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Author</Label>
                  <Input defaultValue={video.author} onBlur={e => updateVideo.mutate({ author: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Source Type</Label>
                  <Input value={video.sourceType} readOnly className="opacity-60" />
                </div>
              </div>
              {video.sourceUrl && (
                <div className="space-y-1.5">
                  <Label>Source URL</Label>
                  <Input defaultValue={video.sourceUrl} onBlur={e => updateVideo.mutate({ sourceUrl: e.target.value })} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea defaultValue={video.description} onBlur={e => updateVideo.mutate({ description: e.target.value })} rows={3} />
              </div>
            </CardContent>
          </Card>

          <Card className="border border-card-border">
            <CardHeader><CardTitle className="text-base">Video Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: "Public ID", value: video.publicId },
                  { label: "Status", value: video.status },
                  { label: "Source Type", value: video.sourceType },
                  { label: "Available", value: video.available ? "Yes" : "No" },
                  { label: "Created", value: format(new Date(video.createdAt), "PPP") },
                  { label: "Qualities", value: (video.qualities || []).map((q: number) => `${q}p`).join(", ") || "—" },
                ].map(item => (
                  <div key={item.label}>
                    <dt className="text-muted-foreground text-xs">{item.label}</dt>
                    <dd className="font-medium text-foreground capitalize">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Player Settings */}
        <TabsContent value="player" className="mt-4">
          <Card className="border border-card-border">
            <CardHeader>
              <CardTitle className="text-base">Player Controls</CardTitle>
              <CardDescription>Configure what the viewer can interact with</CardDescription>
            </CardHeader>
            <CardContent>
              {[
                { key: "allowSpeed", label: "Speed Control", desc: "Allow playback speed adjustment (0.5x–3x)" },
                { key: "allowQuality", label: "Quality Selection", desc: "Allow viewer to switch between quality levels" },
                { key: "allowFullscreen", label: "Fullscreen", desc: "Allow fullscreen mode" },
                { key: "allowSkip", label: "Seek / Skip", desc: "Allow seeking and ±10s skip buttons" },
                { key: "allowBrightness", label: "Brightness Control", desc: "Allow brightness adjustment via CSS filter" },
                { key: "resumeEnabled", label: "Resume Playback", desc: "Resume from last watched position" },
                { key: "autoplayAllowed", label: "Autoplay", desc: "Attempt autoplay on embed load (muted)" },
              ].map(s => (
                <SettingRow key={s.key} label={s.label} description={s.desc}>
                  <Switch
                    checked={!!ps[s.key]}
                    onCheckedChange={val => updatePlayer.mutate({ ...ps, [s.key]: val })}
                    data-testid={`switch-${s.key}`}
                  />
                </SettingRow>
              ))}
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Start Time (seconds)</Label>
                  <Input
                    type="number" min={0} defaultValue={ps.startTime || 0}
                    onBlur={e => updatePlayer.mutate({ ...ps, startTime: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>End Time (seconds, 0 = full)</Label>
                  <Input
                    type="number" min={0} defaultValue={ps.endTime || 0}
                    onBlur={e => updatePlayer.mutate({ ...ps, endTime: parseInt(e.target.value) || null })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Watermark Settings */}
        <TabsContent value="watermark" className="mt-4 space-y-4">
          <Card className="border border-card-border">
            <CardHeader><CardTitle className="text-base">Logo Watermark</CardTitle></CardHeader>
            <CardContent>
              <SettingRow label="Enable Logo" description="Show a logo image overlay on the player">
                <Switch checked={!!ws.logoEnabled} onCheckedChange={val => updateWatermark.mutate({ ...ws, logoEnabled: val })} />
              </SettingRow>
              {ws.logoEnabled && (
                <div className="mt-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label>Logo URL</Label>
                    <Input defaultValue={ws.logoUrl || ""} placeholder="https://..." onBlur={e => updateWatermark.mutate({ ...ws, logoUrl: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Position</Label>
                    <Select value={ws.logoPosition || "top-right"} onValueChange={val => updateWatermark.mutate({ ...ws, logoPosition: val })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["top-left","top-right","bottom-left","bottom-right","center"].map(p => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Opacity: {Math.round((ws.logoOpacity ?? 0.8) * 100)}%</Label>
                    <Slider
                      value={[(ws.logoOpacity ?? 0.8) * 100]}
                      min={10} max={100} step={5}
                      onValueChange={([v]) => updateWatermark.mutate({ ...ws, logoOpacity: v / 100 })}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-card-border">
            <CardHeader><CardTitle className="text-base">Scrolling Ticker</CardTitle></CardHeader>
            <CardContent>
              <SettingRow label="Enable Ticker" description="Show a scrolling text banner">
                <Switch checked={!!ws.tickerEnabled} onCheckedChange={val => updateWatermark.mutate({ ...ws, tickerEnabled: val })} />
              </SettingRow>
              {ws.tickerEnabled && (
                <div className="mt-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label>Ticker Text</Label>
                    <Input
                      defaultValue={ws.tickerText || ""}
                      placeholder="Use {DOMAIN} {VIDEO_ID} {SESSION_CODE} {TIME}"
                      onBlur={e => updateWatermark.mutate({ ...ws, tickerText: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Variables: {"{DOMAIN}"} {"{VIDEO_ID}"} {"{SESSION_CODE}"} {"{TIME}"}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Speed: {ws.tickerSpeed || 50}px/s</Label>
                    <Slider value={[ws.tickerSpeed || 50]} min={10} max={200} step={10} onValueChange={([v]) => updateWatermark.mutate({ ...ws, tickerSpeed: v })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Opacity: {Math.round((ws.tickerOpacity ?? 0.7) * 100)}%</Label>
                    <Slider value={[(ws.tickerOpacity ?? 0.7) * 100]} min={10} max={100} step={5} onValueChange={([v]) => updateWatermark.mutate({ ...ws, tickerOpacity: v / 100 })} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-card-border">
            <CardHeader><CardTitle className="text-base">Pop-up Watermark</CardTitle></CardHeader>
            <CardContent>
              <SettingRow label="Enable Pop Watermark" description="Show periodic pop-up text overlays">
                <Switch checked={!!ws.popEnabled} onCheckedChange={val => updateWatermark.mutate({ ...ws, popEnabled: val })} />
              </SettingRow>
              {ws.popEnabled && (
                <div className="mt-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label>Pop Text</Label>
                    <Input defaultValue={ws.popText || "{DOMAIN}"} placeholder="{DOMAIN}" onBlur={e => updateWatermark.mutate({ ...ws, popText: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Position Mode</Label>
                    <Select value={ws.popMode || "random"} onValueChange={val => updateWatermark.mutate({ ...ws, popMode: val })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="random">Random (corners + center)</SelectItem>
                        <SelectItem value="corners">Corners only</SelectItem>
                        <SelectItem value="center">Center only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Interval (seconds)</Label>
                      <Input type="number" min={5} defaultValue={ws.popInterval || 30} onBlur={e => updateWatermark.mutate({ ...ws, popInterval: parseInt(e.target.value) })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Duration (seconds)</Label>
                      <Input type="number" min={1} defaultValue={ws.popDuration || 3} onBlur={e => updateWatermark.mutate({ ...ws, popDuration: parseInt(e.target.value) })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Opacity: {Math.round((ws.popOpacity ?? 0.8) * 100)}%</Label>
                    <Slider value={[(ws.popOpacity ?? 0.8) * 100]} min={10} max={100} step={5} onValueChange={([v]) => updateWatermark.mutate({ ...ws, popOpacity: v / 100 })} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="mt-4 space-y-4">
          <Card className="border border-card-border">
            <CardHeader><CardTitle className="text-base">Access & Token Security</CardTitle></CardHeader>
            <CardContent>
              {[
                { key: "tokenRequired", label: "Require Token", desc: "All playback requires a valid embed token" },
                { key: "signedUrls", label: "Signed HLS URLs", desc: "Use time-limited signed URLs for HLS segments" },
                { key: "hotlinkProtection", label: "Hotlink Protection", desc: "Check Referer/Origin headers on requests" },
                { key: "referrerStrict", label: "Strict Referrer Check", desc: "Block requests with missing referer header" },
                { key: "rateLimitEnabled", label: "Rate Limiting", desc: "Limit requests per token/IP" },
              ].map(s => (
                <SettingRow key={s.key} label={s.label} description={s.desc}>
                  <Switch checked={!!ss[s.key]} onCheckedChange={val => updateSecurity.mutate({ ...ss, [s.key]: val })} data-testid={`switch-${s.key}`} />
                </SettingRow>
              ))}
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Signed URL TTL (seconds)</Label>
                  <Input type="number" min={10} defaultValue={ss.signedUrlTtl || 120} onBlur={e => updateSecurity.mutate({ ...ss, signedUrlTtl: parseInt(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Token TTL (seconds)</Label>
                  <Input type="number" min={60} defaultValue={ss.tokenTtl || 86400} onBlur={e => updateSecurity.mutate({ ...ss, tokenTtl: parseInt(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Concurrent Session Limit</Label>
                  <Input type="number" min={1} defaultValue={ss.concurrentLimit || 5} onBlur={e => updateSecurity.mutate({ ...ss, concurrentLimit: parseInt(e.target.value) })} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-card-border">
            <CardHeader>
              <CardTitle className="text-base">Domain Whitelist</CardTitle>
              <CardDescription>Only allow playback from specific domains</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingRow label="Enable Domain Whitelist" description="Block playback from domains not in the list">
                <Switch checked={!!ss.domainWhitelistEnabled} onCheckedChange={val => updateSecurity.mutate({ ...ss, domainWhitelistEnabled: val })} />
              </SettingRow>
              {ss.domainWhitelistEnabled && (
                <div className="mt-4 space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={domainInput}
                      onChange={e => setDomainInput(e.target.value)}
                      placeholder="example.com"
                      onKeyDown={e => {
                        if (e.key === "Enter" && domainInput.trim()) {
                          const domains = [...(ss.allowedDomains || []), domainInput.trim()];
                          updateSecurity.mutate({ ...ss, allowedDomains: domains });
                          setDomainInput("");
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (domainInput.trim()) {
                          const domains = [...(ss.allowedDomains || []), domainInput.trim()];
                          updateSecurity.mutate({ ...ss, allowedDomains: domains });
                          setDomainInput("");
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(ss.allowedDomains || []).map((domain: string) => (
                      <Badge key={domain} variant="secondary" className="gap-1.5">
                        {domain}
                        <button
                          onClick={() => updateSecurity.mutate({ ...ss, allowedDomains: ss.allowedDomains.filter((d: string) => d !== domain) })}
                          className="hover:text-destructive"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                    {!(ss.allowedDomains?.length) && <p className="text-sm text-muted-foreground">No domains added yet</p>}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Embed & Share */}
        <TabsContent value="embed" className="mt-4 space-y-4">
          <Card className="border border-card-border">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Embed Codes</CardTitle>
                <CardDescription>Use these in external websites</CardDescription>
              </div>
              <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-create-token">
                    <Plus className="h-3.5 w-3.5 mr-1" />New Token
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Create Embed Token</DialogTitle></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label>Label</Label>
                      <Input value={tokenLabel} onChange={e => setTokenLabel(e.target.value)} placeholder="Website Name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Allowed Domain (optional)</Label>
                      <Input value={tokenDomain} onChange={e => setTokenDomain(e.target.value)} placeholder="example.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Expires In (hours)</Label>
                      <Select value={tokenTtl} onValueChange={setTokenTtl}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 hour</SelectItem>
                          <SelectItem value="24">24 hours</SelectItem>
                          <SelectItem value="168">7 days</SelectItem>
                          <SelectItem value="720">30 days</SelectItem>
                          <SelectItem value="8760">1 year</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setTokenDialogOpen(false)}>Cancel</Button>
                    <Button onClick={() => createToken.mutate()} disabled={createToken.isPending}>Create Token</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-5">
              {!firstToken && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-600 dark:text-amber-400">
                  Create a token above to generate embed codes with authentication.
                </div>
              )}

              <div className="space-y-2">
                <Label>iFrame Embed Code</Label>
                <div className="relative">
                  <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto border border-border whitespace-pre-wrap break-all">{iframeCode}</pre>
                </div>
                <CopyButton text={iframeCode} label="Copy iFrame" />
              </div>

              <div className="space-y-2">
                <Label>Masked Share Link</Label>
                <div className="flex items-center gap-2">
                  <Input value={shareLink} readOnly className="font-mono text-xs" />
                  <CopyButton text={shareLink} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Public Video ID</Label>
                <div className="flex items-center gap-2">
                  <Input value={video.publicId} readOnly className="font-mono text-sm" />
                  <CopyButton text={video.publicId} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="mt-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {[
              { label: "Total Plays", value: analytics?.totalPlays ?? 0 },
              { label: "Unique Domains", value: analytics?.uniqueDomains ?? 0 },
              { label: "Total Watch Time", value: analytics?.totalWatchSeconds ? `${Math.round(analytics.totalWatchSeconds / 60)}m` : "0m" },
            ].map(stat => (
              <Card key={stat.label} className="border border-card-border">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {analytics?.recentSessions?.length > 0 && (
            <Card className="border border-card-border">
              <CardHeader><CardTitle className="text-base">Recent Sessions</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 text-xs text-muted-foreground font-medium">Domain</th>
                        <th className="text-left py-2 text-xs text-muted-foreground font-medium">IP</th>
                        <th className="text-left py-2 text-xs text-muted-foreground font-medium">Watch Time</th>
                        <th className="text-left py-2 text-xs text-muted-foreground font-medium">Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.recentSessions.map((s: any) => (
                        <tr key={s.id} className="border-b border-border last:border-0">
                          <td className="py-2 text-foreground">{s.domain || "—"}</td>
                          <td className="py-2 text-muted-foreground">{s.ip || "—"}</td>
                          <td className="py-2 text-foreground">{s.secondsWatched || 0}s</td>
                          <td className="py-2 text-muted-foreground text-xs">{formatDistanceToNow(new Date(s.startedAt), { addSuffix: true })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tokens */}
        <TabsContent value="audit" className="mt-4">
          <Card className="border border-card-border">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Embed Tokens</CardTitle>
              <Button size="sm" onClick={() => setTokenDialogOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />New Token
              </Button>
            </CardHeader>
            <CardContent>
              {tokens.length === 0 ? (
                <div className="flex flex-col items-center py-8">
                  <Key className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No tokens yet. Create one to generate embed codes.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tokens.map(token => {
                    const expired = token.expiresAt && new Date(token.expiresAt) < new Date();
                    return (
                      <div key={token.id} className={`flex items-center gap-3 rounded-md border p-3 ${token.revoked ? "border-border opacity-60" : "border-border"}`} data-testid={`token-${token.id}`}>
                        <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">{token.label || "Token"}</span>
                            {token.revoked && <Badge variant="destructive" className="text-xs">Revoked</Badge>}
                            {expired && !token.revoked && <Badge variant="outline" className="text-xs">Expired</Badge>}
                            {!token.revoked && !expired && <Badge variant="secondary" className="text-xs">Active</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {token.allowedDomain && `Domain: ${token.allowedDomain} · `}
                            {token.expiresAt ? `Expires ${formatDistanceToNow(new Date(token.expiresAt), { addSuffix: true })}` : "No expiry"}
                          </p>
                          <p className="text-xs font-mono text-muted-foreground mt-1 truncate max-w-sm">{token.token}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <CopyButton text={token.token} />
                          {!token.revoked && (
                            <Button size="sm" variant="outline" onClick={() => revokeToken.mutate(token.id)}>Revoke</Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => deleteToken.mutate(token.id)}>
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
