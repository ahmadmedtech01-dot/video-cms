import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Settings, Cloud, Shield, Zap, AlertTriangle, CheckCircle, Eye, EyeOff,
  Save, Server, Database, Key, Video, RefreshCw,
} from "lucide-react";

const AWS_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-central-1", "eu-north-1",
  "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-south-1",
  "ca-central-1", "sa-east-1",
];

export default function SystemSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showSecret, setShowSecret] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [killSwitch, setKillSwitch] = useState(false);

  const { data: settings = [], isLoading } = useQuery<{ key: string; value: string }[]>({
    queryKey: ["/api/settings"],
    queryFn: () => fetch("/api/settings").then(r => r.json()),
  });

  useEffect(() => {
    if (settings.length > 0) {
      const obj: Record<string, string> = {};
      settings.forEach(s => { obj[s.key] = s.value || ""; });
      setFormData(obj);
      setKillSwitch(obj.global_kill_switch === "true");
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: (data: Record<string, string>) => apiRequest("PUT", "/api/settings", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved successfully" });
    },
    onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
  });

  const handleChange = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveS3 = () => {
    save.mutate({
      aws_access_key_id: formData.aws_access_key_id || "",
      aws_secret_access_key: formData.aws_secret_access_key || "",
      aws_region: formData.aws_region || "us-east-1",
      s3_bucket: formData.s3_bucket || "",
      s3_private_prefix: formData.s3_private_prefix || "raw/",
      s3_hls_prefix: formData.s3_hls_prefix || "hls/",
    });
  };

  const handleSaveGeneral = () => {
    save.mutate({
      signing_secret: formData.signing_secret || "",
      max_upload_size_mb: formData.max_upload_size_mb || "2048",
      ffmpeg_enabled: formData.ffmpeg_enabled || "true",
    });
  };

  const handleToggleKillSwitch = (val: boolean) => {
    setKillSwitch(val);
    save.mutate({ global_kill_switch: val ? "true" : "false" });
  };

  const s3Configured = !!(formData.aws_access_key_id && formData.s3_bucket && formData.aws_region);

  const [vimeoHealth, setVimeoHealth] = useState<{ ok: boolean; name?: string; accountType?: string; error?: string; hint?: string; hints?: string[] } | null>(null);
  const [vimeoHealthLoading, setVimeoHealthLoading] = useState(false);

  const handleTestVimeo = async () => {
    setVimeoHealthLoading(true);
    setVimeoHealth(null);
    try {
      if (formData.vimeo_access_token) {
        await apiRequest("PUT", "/api/settings", { vimeo_access_token: formData.vimeo_access_token });
      }
      const res = await fetch("/api/integrations/vimeo/health");
      const data = await res.json();
      setVimeoHealth(data);
    } catch (e: any) {
      setVimeoHealth({ ok: false, error: e.message });
    } finally {
      setVimeoHealthLoading(false);
    }
  };

  const handleSaveVimeo = () => {
    save.mutate({ vimeo_access_token: formData.vimeo_access_token || "" });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">System Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure AWS, storage, security, and global controls</p>
      </div>

      {/* Kill Switch */}
      <Card className={`border ${killSwitch ? "border-destructive" : "border-card-border"}`}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className={`h-4 w-4 ${killSwitch ? "text-destructive" : "text-muted-foreground"}`} />
            Global Kill Switch
            {killSwitch && <Badge variant="destructive" className="ml-auto">ACTIVE</Badge>}
          </CardTitle>
          <CardDescription>
            When ON, all video playback endpoints return 503. Use in emergencies.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 rounded-lg border border-border p-4">
            <AlertTriangle className={`h-5 w-5 shrink-0 ${killSwitch ? "text-destructive" : "text-muted-foreground"}`} />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Disable all video playback</p>
              <p className="text-xs text-muted-foreground">All embeds and share links will show "Service temporarily disabled"</p>
            </div>
            <Switch
              checked={killSwitch}
              onCheckedChange={handleToggleKillSwitch}
              data-testid="switch-kill-switch"
            />
          </div>
        </CardContent>
      </Card>

      {/* AWS / S3 Configuration */}
      <Card className="border border-card-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            AWS / S3 Storage
            {s3Configured
              ? <Badge className="ml-auto bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0"><CheckCircle className="h-3 w-3 mr-1" />Configured</Badge>
              : <Badge variant="outline" className="ml-auto text-muted-foreground">Not Configured</Badge>
            }
          </CardTitle>
          <CardDescription>
            Configure your S3 bucket for video storage and HLS streaming. Required for video uploads.
            You can update these anytime — changes take effect immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>AWS Access Key ID</Label>
              <Input
                type="text"
                value={formData.aws_access_key_id || ""}
                onChange={e => handleChange("aws_access_key_id", e.target.value)}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                data-testid="input-aws-key"
              />
            </div>
            <div className="space-y-1.5">
              <Label>AWS Secret Access Key</Label>
              <div className="relative">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={formData.aws_secret_access_key || ""}
                  onChange={e => handleChange("aws_secret_access_key", e.target.value)}
                  placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                  className="pr-9"
                  data-testid="input-aws-secret"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>AWS Region</Label>
              <Select value={formData.aws_region || "us-east-1"} onValueChange={v => handleChange("aws_region", v)}>
                <SelectTrigger data-testid="select-aws-region">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AWS_REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>S3 Bucket Name</Label>
              <Input
                value={formData.s3_bucket || ""}
                onChange={e => handleChange("s3_bucket", e.target.value)}
                placeholder="my-video-bucket"
                data-testid="input-s3-bucket"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Raw Upload Prefix</Label>
              <Input
                value={formData.s3_private_prefix || "raw/"}
                onChange={e => handleChange("s3_private_prefix", e.target.value)}
                placeholder="raw/"
              />
            </div>
            <div className="space-y-1.5">
              <Label>HLS Output Prefix</Label>
              <Input
                value={formData.s3_hls_prefix || "hls/"}
                onChange={e => handleChange("s3_hls_prefix", e.target.value)}
                placeholder="hls/"
              />
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Server className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p>Your S3 bucket should be <strong className="text-foreground">private</strong> (no public access). The server generates short-lived signed URLs for secure playback.</p>
              <p className="mt-1">Currently supporting: S3 uploads, YouTube, Vimeo, Google Drive, OneDrive, and direct URL imports.</p>
            </div>
          </div>
          <Button onClick={handleSaveS3} disabled={save.isPending} data-testid="button-save-s3">
            <Save className="h-4 w-4 mr-1.5" />
            Save S3 Configuration
          </Button>
        </CardContent>
      </Card>

      {/* General / Security */}
      <Card className="border border-card-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security & Processing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Signing Secret</Label>
            <Input
              type="password"
              value={formData.signing_secret || ""}
              onChange={e => handleChange("signing_secret", e.target.value)}
              placeholder="Random secret for embed token signing"
              data-testid="input-signing-secret"
            />
            <p className="text-xs text-muted-foreground">Used to sign JWT embed tokens. Keep this secret and random (32+ chars).</p>
          </div>
          <div className="space-y-1.5">
            <Label>Max Upload Size (MB)</Label>
            <Input
              type="number"
              value={formData.max_upload_size_mb || "2048"}
              onChange={e => handleChange("max_upload_size_mb", e.target.value)}
              placeholder="2048"
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium text-foreground">ffmpeg Processing</p>
              <p className="text-xs text-muted-foreground">Enable server-side HLS transcoding via ffmpeg</p>
            </div>
            <Switch
              checked={formData.ffmpeg_enabled === "true"}
              onCheckedChange={val => handleChange("ffmpeg_enabled", val ? "true" : "false")}
              data-testid="switch-ffmpeg"
            />
          </div>
          <Button onClick={handleSaveGeneral} disabled={save.isPending} data-testid="button-save-general">
            <Save className="h-4 w-4 mr-1.5" />
            Save Settings
          </Button>
        </CardContent>
      </Card>

      {/* Vimeo Integration */}
      <Card className="border border-card-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Video className="h-4 w-4" />
            Vimeo Integration
          </CardTitle>
          <CardDescription>
            Configure a Vimeo Personal Access Token to allow the CMS to download and transcode your Vimeo videos to HLS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Vimeo Personal Access Token</Label>
            <Input
              type="password"
              value={formData.vimeo_access_token || ""}
              onChange={e => handleChange("vimeo_access_token", e.target.value)}
              placeholder="Paste your Vimeo Personal Access Token here"
              data-testid="input-vimeo-token"
            />
            <p className="text-xs text-muted-foreground">
              Generate at <a href="https://developer.vimeo.com/apps" target="_blank" rel="noopener noreferrer" className="underline">developer.vimeo.com/apps</a>.
              Token must have scopes: <code className="bg-muted px-1 rounded">public</code>, <code className="bg-muted px-1 rounded">private</code>, <code className="bg-muted px-1 rounded">video_files</code>.
              The <strong>video_files</strong> scope requires a Vimeo Pro+ plan.
            </p>
          </div>

          {vimeoHealth && (
            <div className={`rounded-md border p-3 text-xs space-y-1 ${vimeoHealth.ok ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}>
              {vimeoHealth.ok ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    <span className="font-medium text-green-600 dark:text-green-400">Token is valid</span>
                  </div>
                  <p className="text-muted-foreground">Account: <span className="text-foreground font-medium">{vimeoHealth.name}</span> ({vimeoHealth.accountType})</p>
                  {vimeoHealth.hint && <p className="text-muted-foreground mt-1">{vimeoHealth.hint}</p>}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    <span className="font-medium text-destructive">Token check failed</span>
                  </div>
                  <p className="text-muted-foreground">{vimeoHealth.error}</p>
                  {(vimeoHealth.hints || []).map((h, i) => (
                    <p key={i} className="text-muted-foreground">• {h}</p>
                  ))}
                </>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleSaveVimeo} disabled={save.isPending} variant="outline" data-testid="button-save-vimeo">
              <Save className="h-4 w-4 mr-1.5" />
              Save Token
            </Button>
            <Button onClick={handleTestVimeo} disabled={vimeoHealthLoading} variant="outline" data-testid="button-test-vimeo">
              <RefreshCw className={`h-4 w-4 mr-1.5 ${vimeoHealthLoading ? "animate-spin" : ""}`} />
              {vimeoHealthLoading ? "Testing…" : "Test Connection"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card className="border border-card-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            System Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              { label: "Version", value: "1.0.0" },
              { label: "Database", value: "PostgreSQL" },
              { label: "S3 Status", value: s3Configured ? "Configured" : "Not configured" },
              { label: "ffmpeg", value: formData.ffmpeg_enabled === "true" ? "Enabled" : "Disabled" },
            ].map(item => (
              <div key={item.label}>
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="font-medium text-foreground">{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
