import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Link as LinkIcon, Youtube, Video, X, CloudUpload, CheckCircle, AlertCircle } from "lucide-react";

const QUALITY_OPTIONS = [
  { value: 240, label: "240p" },
  { value: 360, label: "360p" },
  { value: 480, label: "480p" },
  { value: 720, label: "720p (HD)" },
  { value: 1080, label: "1080p (Full HD)" },
];

const SOURCE_TYPES = [
  { value: "youtube", label: "YouTube", icon: Youtube, placeholder: "https://youtube.com/watch?v=..." },
  { value: "vimeo", label: "Vimeo", icon: Video, placeholder: "https://vimeo.com/..." },
  { value: "drive", label: "Google Drive", icon: LinkIcon, placeholder: "https://drive.google.com/..." },
  { value: "onedrive", label: "OneDrive", icon: LinkIcon, placeholder: "https://onedrive.live.com/..." },
  { value: "s3", label: "S3 URL", icon: LinkIcon, placeholder: "s3://bucket/path or https://..." },
  { value: "direct", label: "Direct URL", icon: LinkIcon, placeholder: "https://example.com/video.mp4" },
];

export default function UploadPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [tags, setTags] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [qualities, setQualities] = useState<number[]>([720]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "processing" | "done" | "error">("idle");
  const [sourceType, setSourceType] = useState("youtube");
  const [sourceUrl, setSourceUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const createVideoMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/videos", data),
    onSuccess: async (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/videos"] });
      return data;
    },
  });

  const toggleQuality = (q: number) => {
    setQualities(prev =>
      prev.includes(q) ? prev.filter(x => x !== q) : [...prev, q]
    );
  };

  const handleFileSelect = (f: File) => {
    if (!f.type.startsWith("video/")) {
      toast({ title: "Invalid file", description: "Please select a video file", variant: "destructive" });
      return;
    }
    setSelectedFile(f);
  };

  const handleUpload = async () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    if (!selectedFile) {
      toast({ title: "Please select a file", variant: "destructive" });
      return;
    }

    setUploadState("uploading");
    setUploadProgress(0);

    try {
      const video = await createVideoMutation.mutateAsync({
        title,
        description,
        author,
        tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        sourceType: "upload",
      });

      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("qualities", JSON.stringify(qualities));

      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(xhr.responseText));
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.open("POST", `/api/videos/${video.id}/upload`);
        xhr.send(formData);
      });

      setUploadState("processing");
      toast({ title: "Upload complete!", description: "Video is being processed into HLS streams." });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["/api/videos"] });
        setLocation(`/videos/${video.id}`);
      }, 2000);
    } catch (e: any) {
      setUploadState("error");
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    }
  };

  const handleImport = async () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    if (!sourceUrl.trim()) {
      toast({ title: "URL required", variant: "destructive" });
      return;
    }

    try {
      const video = await createVideoMutation.mutateAsync({
        title, description, author,
        tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        sourceType,
        sourceUrl,
      });
      qc.invalidateQueries({ queryKey: ["/api/videos"] });
      toast({ title: "Video imported!" });
      setLocation(`/videos/${video.id}`);
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Add Video</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Upload from your device or import from a URL</p>
      </div>

      {/* Metadata */}
      <Card className="border border-card-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Video Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="My awesome video" data-testid="input-title" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="author">Author</Label>
              <Input id="author" value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author name" data-testid="input-author" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input id="tags" value={tags} onChange={e => setTags(e.target.value)} placeholder="tutorial, demo" data-testid="input-tags" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Video description..." rows={3} data-testid="input-description" />
          </div>
        </CardContent>
      </Card>

      {/* Source */}
      <Card className="border border-card-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Video Source</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="upload">
            <TabsList className="mb-4">
              <TabsTrigger value="upload" data-testid="tab-upload"><Upload className="h-3.5 w-3.5 mr-1.5" />Upload File</TabsTrigger>
              <TabsTrigger value="import" data-testid="tab-import"><LinkIcon className="h-3.5 w-3.5 mr-1.5" />Import URL</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              {/* Dropzone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 cursor-pointer transition-colors
                  ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50"}`}
                data-testid="dropzone-upload"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                />
                <CloudUpload className="h-10 w-10 text-muted-foreground" />
                {selectedFile ? (
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">Drop video here or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-1">Supports MP4, MOV, AVI, MKV, WebM — up to 4GB</p>
                  </div>
                )}
              </div>

              {selectedFile && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)}>
                  <X className="h-4 w-4 mr-1" />Remove file
                </Button>
              )}

              {/* Quality Selection */}
              <div className="space-y-2">
                <Label>Output Qualities (HLS variants)</Label>
                <div className="flex flex-wrap gap-2">
                  {QUALITY_OPTIONS.map(q => (
                    <label key={q.value} className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={qualities.includes(q.value)}
                        onCheckedChange={() => toggleQuality(q.value)}
                        data-testid={`checkbox-quality-${q.value}`}
                      />
                      <span className="text-sm text-foreground">{q.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Upload Progress */}
              {uploadState !== "idle" && (
                <div className="space-y-2 rounded-lg border border-border p-4">
                  {uploadState === "uploading" && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">Uploading...</span>
                        <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
                      </div>
                      <Progress value={uploadProgress} />
                    </>
                  )}
                  {uploadState === "processing" && (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      <span className="text-sm">Processing HLS streams — this may take a few minutes...</span>
                    </div>
                  )}
                  {uploadState === "done" && (
                    <div className="flex items-center gap-2 text-emerald-600">
                      <CheckCircle className="h-4 w-4" />
                      <span className="text-sm">Done! Redirecting...</span>
                    </div>
                  )}
                  {uploadState === "error" && (
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm">Upload failed. Please try again.</span>
                    </div>
                  )}
                </div>
              )}

              <Button
                onClick={handleUpload}
                disabled={!selectedFile || uploadState === "uploading" || uploadState === "processing"}
                className="w-full"
                data-testid="button-start-upload"
              >
                <Upload className="h-4 w-4 mr-1.5" />
                {uploadState === "uploading" ? "Uploading..." : uploadState === "processing" ? "Processing..." : "Start Upload"}
              </Button>
            </TabsContent>

            <TabsContent value="import" className="space-y-4">
              <div className="space-y-2">
                <Label>Source Platform</Label>
                <Select value={sourceType} onValueChange={setSourceType}>
                  <SelectTrigger data-testid="select-source-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPES.map(s => (
                      <SelectItem key={s.value} value={s.value}>
                        <div className="flex items-center gap-2">
                          <s.icon className="h-4 w-4" />
                          {s.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Video URL</Label>
                <Input
                  value={sourceUrl}
                  onChange={e => setSourceUrl(e.target.value)}
                  placeholder={SOURCE_TYPES.find(s => s.value === sourceType)?.placeholder}
                  data-testid="input-source-url"
                />
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  For YouTube, Vimeo, and Drive: the video URL will be used to render the player.
                  For S3 and direct URLs: HLS processing will be attempted if ffmpeg is available.
                </p>
              </div>
              <Button
                onClick={handleImport}
                disabled={createVideoMutation.isPending}
                className="w-full"
                data-testid="button-import"
              >
                <LinkIcon className="h-4 w-4 mr-1.5" />
                {createVideoMutation.isPending ? "Importing..." : "Import Video"}
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
