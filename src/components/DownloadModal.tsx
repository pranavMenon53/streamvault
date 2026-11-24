import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HardDrive,
  KeyRound,
  Loader2,
  Music,
  Video,
  X,
} from 'lucide-react';
import { saveOfflineVideo, triggerDeviceBlobDownload } from '../lib/offlineDb';
import { formatBytes, sanitizeFileName } from '../lib/youtubeUrl';
import type { VideoDetailsResponse, VideoItem } from '../types/video';
import { VideoThumbnail } from './VideoThumbnail';

interface DownloadModalProps {
  video: VideoItem | null;
  isOpen: boolean;
  sessionCookie: string;
  onSessionCookieChange: (cookie: string) => void;
  onClose: () => void;
  onSavedToVault: () => void;
  onStartBrowserCapture: (video: VideoItem, alsoDownloadToDisk: boolean) => void;
}

type FormatKind = 'mp4' | 'audio';
type QualityChoice = '1080p' | '720p' | '480p' | '360p';

async function fetchThumbnailAsDataUrl(url: string): Promise<string | undefined> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return undefined;
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export function DownloadModal({
  video,
  isOpen,
  sessionCookie,
  onSessionCookieChange,
  onClose,
  onSavedToVault,
  onStartBrowserCapture,
}: DownloadModalProps) {
  const [activeTab, setActiveTab] = useState<'direct' | 'capture'>('direct');
  const [formatKind, setFormatKind] = useState<FormatKind>('mp4');
  const [quality, setQuality] = useState<QualityChoice>('720p');
  const [saveToDisk, setSaveToDisk] = useState(true);
  const [saveToVault, setSaveToVault] = useState(true);
  const [showCookieField, setShowCookieField] = useState(false);

  const [details, setDetails] = useState<VideoDetailsResponse | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !video) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    setDownloadedBytes(0);
    setTotalBytes(null);
    setIsInspecting(true);

    const controller = new AbortController();
    fetch('/api/video-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urlOrId: video.id,
        cookie: sessionCookie.trim() || undefined,
      }),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: VideoDetailsResponse) => {
        setDetails(data);
        if (data.botCheckRequired) {
          setShowCookieField(true);
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name !== 'AbortError') {
          setDetails(null);
        }
      })
      .finally(() => setIsInspecting(false));

    return () => controller.abort();
  }, [isOpen, video?.id, sessionCookie]);

  if (!isOpen || !video) return null;

  const handleDirectDownload = async () => {
    if (!saveToDisk && !saveToVault) {
      setErrorMessage('Select at least one destination: Device Downloads or Offline Vault.');
      return;
    }

    setIsDownloading(true);
    setDownloadedBytes(0);
    setTotalBytes(null);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.id,
          format: formatKind,
          quality,
          cookie: sessionCookie.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const errPayload = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        if (errPayload.error === 'YOUTUBE_BOT_CHECK') {
          setShowCookieField(true);
          setErrorMessage(
            errPayload.message ||
              'YouTube asked this cloud server to verify a session cookie. Try Browser Capture below (no cookie needed) or paste a YouTube session cookie.'
          );
          return;
        }
        throw new Error(errPayload.message || errPayload.error || 'Download failed');
      }

      const contentLengthHeader = response.headers.get('Content-Length');
      const expectedTotal = contentLengthHeader ? Number(contentLengthHeader) : null;
      if (expectedTotal && Number.isFinite(expectedTotal)) {
        setTotalBytes(expectedTotal);
      }

      const mimeType =
        response.headers.get('X-Mime-Type') ||
        response.headers.get('Content-Type') ||
        (formatKind === 'audio' ? 'audio/mp4' : 'video/mp4');
      const ext =
        mimeType.includes('audio/webm')
          ? 'webm'
          : mimeType.includes('audio')
            ? 'm4a'
            : 'mp4';
      const fallbackFilename = `${sanitizeFileName(video.title)}.${ext}`;
      const filename = response.headers.get('X-File-Name') || fallbackFilename;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Streaming response body unavailable');
      }

      const chunks: BlobPart[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          setDownloadedBytes(received);
        }
      }

      const fileBlob = new Blob(chunks, { type: mimeType });

      if (saveToVault) {
        const thumbnailDataUrl = await fetchThumbnailAsDataUrl(video.thumbnail);
        await saveOfflineVideo({
          id: `${video.id}-${formatKind}-${quality}`,
          title: video.title,
          author: video.author,
          duration: video.duration,
          seconds: video.seconds,
          thumbnailDataUrl,
          mimeType,
          fileExtension: ext,
          sizeBytes: fileBlob.size,
          qualityLabel: formatKind === 'audio' ? 'Audio' : quality,
          savedAt: Date.now(),
          blob: fileBlob,
        });
        onSavedToVault();
      }

      if (saveToDisk) {
        triggerDeviceBlobDownload(fileBlob, filename);
      }

      setSuccessMessage(
        saveToDisk && saveToVault
          ? `Saved ${formatBytes(fileBlob.size)} to your device and Offline Vault.`
          : saveToDisk
            ? `Downloaded ${formatBytes(fileBlob.size)} to your device.`
            : `Saved ${formatBytes(fileBlob.size)} to your Offline Vault.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  const progressPercent =
    totalBytes && totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 id="download-modal-title" className="font-display text-base font-semibold text-white">
            Save Offline Copy
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close download modal"
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Selected video summary */}
          <div className="flex items-start gap-3.5">
            <div className="w-32 shrink-0">
              <VideoThumbnail src={video.thumbnail} alt={video.title} duration={video.duration} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold text-zinc-100">{video.title}</p>
              <p className="mt-1 text-xs text-zinc-400">
                {video.author}
                {video.duration !== '0:00' ? ` · ${video.duration}` : ''}
              </p>
            </div>
          </div>

          {/* Mode tabs */}
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('direct')}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'direct'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Direct MP4 / Audio
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('capture')}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'capture'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Browser Tab Capture
            </button>
          </div>

          {activeTab === 'direct' ? (
            <div className="space-y-4">
              {isInspecting ? (
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking available stream formats...
                </div>
              ) : details?.botCheckRequired ? (
                <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-3.5 text-xs text-amber-200">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div className="space-y-2">
                      <p className="leading-relaxed">
                        YouTube is asking this cloud IP for a session cookie before allowing direct server-side extraction.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('capture')}
                        className="font-medium text-white underline underline-offset-2 hover:text-amber-100"
                      >
                        Switch to Browser Tab Capture (works without cookies)
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Format selection */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-300">Format</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setFormatKind('mp4')}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
                      formatKind === 'mp4'
                        ? 'border-red-500/70 bg-red-600/15 text-white'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    <Video className="h-4 w-4" />
                    MP4 Video
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormatKind('audio')}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
                      formatKind === 'audio'
                        ? 'border-red-500/70 bg-red-600/15 text-white'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    <Music className="h-4 w-4" />
                    Audio Only
                  </button>
                </div>
              </div>

              {formatKind === 'mp4' && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-zinc-300">Resolution</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['1080p', '720p', '480p', '360p'] as QualityChoice[]).map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setQuality(q)}
                        className={`rounded-lg border py-2 font-mono text-xs font-medium tabular-nums transition-colors ${
                          quality === q
                            ? 'border-red-500/70 bg-red-600/15 text-white'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                        }`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Destination checkboxes */}
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <label className="flex cursor-pointer items-center justify-between text-xs text-zinc-200">
                  <span className="flex items-center gap-2">
                    <Download className="h-3.5 w-3.5 text-zinc-400" />
                    Download file to my device
                  </span>
                  <input
                    type="checkbox"
                    checked={saveToDisk}
                    onChange={(e) => setSaveToDisk(e.target.checked)}
                    className="h-4 w-4 accent-red-600"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between text-xs text-zinc-200">
                  <span className="flex items-center gap-2">
                    <HardDrive className="h-3.5 w-3.5 text-zinc-400" />
                    Save copy to Offline Vault (watch offline in app)
                  </span>
                  <input
                    type="checkbox"
                    checked={saveToVault}
                    onChange={(e) => setSaveToVault(e.target.checked)}
                    className="h-4 w-4 accent-red-600"
                  />
                </label>
              </div>

              {/* Optional session cookie */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowCookieField((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {showCookieField ? 'Hide optional YouTube cookie' : 'Optional: Add YouTube session cookie'}
                </button>
                {showCookieField && (
                  <div className="mt-2 space-y-1.5">
                    <textarea
                      rows={2}
                      value={sessionCookie}
                      onChange={(e) => onSessionCookieChange(e.target.value)}
                      placeholder="Paste YouTube Cookie header string (kept only in memory for this session)"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Progress / Error / Success */}
              {isDownloading && (
                <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex items-center justify-between text-xs text-zinc-300">
                    <span>Downloading & processing...</span>
                    <span className="font-mono tabular-nums">
                      {formatBytes(downloadedBytes)}
                      {totalBytes ? ` / ${formatBytes(totalBytes)} (${progressPercent}%)` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-red-600 transition-all duration-150"
                      style={{ width: `${progressPercent ?? 45}%` }}
                    />
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-200">
                  {errorMessage}
                </div>
              )}

              {successMessage && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{successMessage}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 whitespace-nowrap"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={handleDirectDownload}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5" />
                      Download Copy
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-300">
                <p className="font-medium text-zinc-100">
                  Capture an offline video copy directly in your browser
                </p>
                <p className="mt-1.5 text-zinc-400">
                  Select this browser tab and enable <strong className="text-zinc-200">Share tab audio</strong> when prompted. Recording runs locally on your device, bypasses cloud IP restrictions, and saves directly to your Offline Vault and Downloads folder.
                </p>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-200">
                <span className="flex items-center gap-2">
                  <Download className="h-3.5 w-3.5 text-zinc-400" />
                  Also download file to my device when capture stops
                </span>
                <input
                  type="checkbox"
                  checked={saveToDisk}
                  onChange={(e) => setSaveToDisk(e.target.checked)}
                  className="h-4 w-4 accent-red-600"
                />
              </label>

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartBrowserCapture(video, saveToDisk);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 whitespace-nowrap"
                >
                  <Video className="h-3.5 w-3.5" />
                  Start Tab Capture
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
