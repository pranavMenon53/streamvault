import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  HardDrive,
  Loader2,
  Play,
  Search,
  X,
} from 'lucide-react';
import { DownloadModal } from './components/DownloadModal';
import { OfflineVaultView } from './components/OfflineVaultView';
import { PlayerStage, type StreamMode } from './components/PlayerStage';
import { VideoThumbnail } from './components/VideoThumbnail';
import {
  getAllOfflineVideos,
  getStorageUsageSummary,
  saveOfflineVideo,
  triggerDeviceBlobDownload,
} from './lib/offlineDb';
import {
  extractYouTubeVideoId,
  formatBytes,
  formatDurationSeconds,
  formatViews,
  sanitizeFileName,
} from './lib/youtubeUrl';
import type { OfflineVideoRecord, VideoItem } from './types/video';

type ActiveView = 'discover' | 'watch' | 'vault';

const DISCOVERY_CATEGORIES = [
  { id: 'open-movies', label: 'Open Movies', query: 'Blender Foundation open movie 4K' },
  { id: 'nature', label: 'Nature 4K', query: '4K nature documentary wildlife ultra hd' },
  { id: 'science', label: 'Science & Space', query: 'NASA 4K space documentary' },
  { id: 'music', label: 'Live Music', query: 'NPR Tiny Desk Concert full' },
  { id: 'tech', label: 'Engineering', query: 'hardware engineering teardown documentary' },
];

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('discover');
  const [searchInput, setSearchInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(DISCOVERY_CATEGORIES[0].id);

  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [currentVideo, setCurrentVideo] = useState<VideoItem | null>(null);
  const [currentOfflineRecord, setCurrentOfflineRecord] = useState<OfflineVideoRecord | null>(null);
  const [streamMode, setStreamMode] = useState<StreamMode>('youtube');

  const [offlineRecords, setOfflineRecords] = useState<OfflineVideoRecord[]>([]);
  const [storageEstimate, setStorageEstimate] = useState({ usedBytes: 0, quotaBytes: 0 });

  const [downloadModalVideo, setDownloadModalVideo] = useState<VideoItem | null>(null);
  const [sessionCookie, setSessionCookie] = useState('');

  const [noticeBanner, setNoticeBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Browser Tab Capture state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);

  const refreshOfflineVault = useCallback(async () => {
    try {
      const [records, estimate] = await Promise.all([
        getAllOfflineVideos(),
        getStorageUsageSummary(),
      ]);
      setOfflineRecords(records);
      setStorageEstimate(estimate);
    } catch {
      // ignore IndexedDB unavailable edge case
    }
  }, []);

  const runSearch = useCallback(async (query: string) => {
    setIsSearching(true);
    setSearchError(null);

    try {
      const directId = extractYouTubeVideoId(query);
      if (directId) {
        const res = await fetch('/api/video-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urlOrId: directId }),
        });
        const data = (await res.json()) as { video?: VideoItem; error?: string };
        if (!res.ok || !data.video) {
          throw new Error(data.error || 'Could not load that YouTube video');
        }
        setCurrentVideo(data.video);
        setCurrentOfflineRecord(null);
        setStreamMode('youtube');
        setActiveView('watch');
        setVideos((prev) =>
          prev.some((v) => v.id === data.video!.id) ? prev : [data.video!, ...prev]
        );
        return;
      }

      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = (await res.json()) as { videos?: VideoItem[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Search failed');
      }
      const list = data.videos ?? [];
      setVideos(list);
      setCurrentVideo((prev) => prev ?? list[0] ?? null);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Unable to search YouTube');
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    void refreshOfflineVault();
    void runSearch(DISCOVERY_CATEGORIES[0].query);
  }, [refreshOfflineVault, runSearch]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }
      captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = searchInput.trim();
    if (!trimmed) return;
    setSelectedCategory('');
    void runSearch(trimmed);
    if (!extractYouTubeVideoId(trimmed)) {
      setActiveView('discover');
    }
  };

  const handleSelectCategory = (category: (typeof DISCOVERY_CATEGORIES)[number]) => {
    setSelectedCategory(category.id);
    setSearchInput('');
    setActiveView('discover');
    void runSearch(category.query);
  };

  const handlePlayOnlineVideo = (video: VideoItem) => {
    setCurrentVideo(video);
    const matchingOffline = offlineRecords.find((r) => r.id.startsWith(`${video.id}-`));
    setCurrentOfflineRecord(matchingOffline ?? null);
    setStreamMode('youtube');
    setActiveView('watch');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePlayOfflineRecord = (record: OfflineVideoRecord) => {
    setCurrentOfflineRecord(record);
    setStreamMode('offline');
    setActiveView('watch');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStopRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    captureStreamRef.current?.getTracks().forEach((t) => t.stop());
    captureStreamRef.current = null;
    setIsRecording(false);
  }, []);

  const handleStartBrowserCapture = async (video: VideoItem, alsoDownloadToDisk: boolean) => {
    setNoticeBanner(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNoticeBanner({
        type: 'error',
        text: 'Screen/tab capture is not supported by this browser. Use Direct MP4 / Audio instead.',
      });
      return;
    }

    setCurrentVideo(video);
    setStreamMode('youtube');
    setActiveView('watch');

    try {
      const displayMediaOptions = {
        video: {
          frameRate: { ideal: 30, max: 60 },
        },
        audio: true,
        preferCurrentTab: true,
      } as DisplayMediaStreamOptions;

      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      captureStreamRef.current = stream;

      const preferredMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : 'video/mp4';

      const recorder = new MediaRecorder(stream, {
        mimeType: preferredMime,
        videoBitsPerSecond: 4_500_000,
      });
      mediaRecorderRef.current = recorder;

      const chunks: BlobPart[] = [];
      let capturedSeconds = 0;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunks.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const cleanMime = preferredMime.split(';')[0] || 'video/webm';
        const ext = cleanMime.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: cleanMime });

        if (blob.size > 0) {
          await saveOfflineVideo({
            id: `${video.id}-capture-${Date.now()}`,
            title: video.title,
            author: video.author,
            duration: formatDurationSeconds(capturedSeconds) || video.duration,
            seconds: capturedSeconds || video.seconds,
            mimeType: cleanMime,
            fileExtension: ext,
            sizeBytes: blob.size,
            qualityLabel: 'Tab Capture',
            savedAt: Date.now(),
            blob,
          });
          await refreshOfflineVault();

          if (alsoDownloadToDisk) {
            triggerDeviceBlobDownload(blob, `${sanitizeFileName(video.title)}.${ext}`);
          }

          setNoticeBanner({
            type: 'success',
            text: `Saved offline copy (${formatBytes(blob.size)}) to your Offline Vault${
              alsoDownloadToDisk ? ' and device Downloads folder' : ''
            }.`,
          });
        }
      };

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        handleStopRecording();
      });

      setRecordingSeconds(0);
      setIsRecording(true);
      recorder.start(1000);

      recordingTimerRef.current = window.setInterval(() => {
        capturedSeconds += 1;
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setIsRecording(false);
      if (err instanceof Error && err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
        setNoticeBanner({
          type: 'error',
          text: err.message || 'Unable to start browser tab capture.',
        });
      }
    }
  };

  const activeWatchTitle =
    streamMode === 'offline' && currentOfflineRecord
      ? currentOfflineRecord.title
      : currentVideo?.title || '';

  const activeWatchAuthor =
    streamMode === 'offline' && currentOfflineRecord
      ? currentOfflineRecord.author
      : currentVideo?.author || '';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Three-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/90 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          {/* Zone 1: Single-element brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveView('discover')}
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            StreamVault
          </button>

          {/* Zone 2: Single-line text navigation links */}
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveView('discover')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeView === 'discover'
                  ? 'border-red-600 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Discover
            </button>
            <button
              type="button"
              onClick={() => setActiveView('watch')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeView === 'watch'
                  ? 'border-red-600 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Now Playing
            </button>
            <button
              type="button"
              onClick={() => setActiveView('vault')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeView === 'vault'
                  ? 'border-red-600 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Offline Vault
              {offlineRecords.length > 0 && (
                <span className="ml-1.5 font-mono text-xs text-zinc-400 tabular-nums">
                  ({offlineRecords.length})
                </span>
              )}
            </button>
          </nav>

          {/* Zone 3: Single primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => {
                if (currentVideo) {
                  setDownloadModalVideo(currentVideo);
                } else {
                  setActiveView('vault');
                }
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              {currentVideo ? 'Download Copy' : 'Offline Vault'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6">
        {/* Global Status Notice */}
        {noticeBanner && (
          <div
            className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs ${
              noticeBanner.type === 'success'
                ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-200'
                : 'border-red-900/60 bg-red-950/30 text-red-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {noticeBanner.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              )}
              <span>{noticeBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setNoticeBanner(null)}
              aria-label="Dismiss notification"
              className="rounded p-1 hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Workspace Toolbar: Search or Paste YouTube URL */}
        {activeView !== 'vault' && (
          <section className="space-y-4">
            <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search YouTube or paste any youtube.com / youtu.be link..."
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2.5 pr-4 pl-10 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading
                  </>
                ) : (
                  'Search / Load'
                )}
              </button>
            </form>

            {/* Category filter tabs */}
            <div className="flex flex-wrap items-center gap-1.5">
              {DISCOVERY_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleSelectCategory(cat)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    selectedCategory === cat.id
                      ? 'bg-zinc-800 text-white'
                      : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* VIEW 1: DISCOVER */}
        {activeView === 'discover' && (
          <section className="space-y-4">
            {searchError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-200">
                {searchError}
              </div>
            )}

            {isSearching ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3"
                  >
                    <div className="aspect-video w-full rounded-lg bg-zinc-800/60" />
                    <div className="h-4 w-4/5 rounded bg-zinc-800/60" />
                    <div className="h-3 w-1/2 rounded bg-zinc-800/40" />
                  </div>
                ))}
              </div>
            ) : videos.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-12 text-center">
                <p className="text-sm text-zinc-400">
                  No videos found. Try another search term or paste a direct YouTube link.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {videos.map((video) => {
                  const hasOffline = offlineRecords.some((r) => r.id.startsWith(`${video.id}-`));
                  return (
                    <article
                      key={video.id}
                      className="group flex flex-col justify-between rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700"
                    >
                      <div>
                        <button
                          type="button"
                          onClick={() => handlePlayOnlineVideo(video)}
                          className="w-full text-left"
                        >
                          <VideoThumbnail
                            src={video.thumbnail}
                            alt={video.title}
                            duration={video.duration}
                          />
                        </button>

                        <button
                          type="button"
                          onClick={() => handlePlayOnlineVideo(video)}
                          className="mt-3 block w-full text-left"
                        >
                          <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-100 group-hover:text-white">
                            {video.title}
                          </h2>
                        </button>

                        {/* Unboxed metadata with typographic separators */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                          <span className="truncate max-w-[160px]">{video.author}</span>
                          {video.views > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">{formatViews(video.views)}</span>
                            </>
                          )}
                          {video.uploaded && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{video.uploaded}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-3">
                        <button
                          type="button"
                          onClick={() => handlePlayOnlineVideo(video)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 whitespace-nowrap"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                          Stream
                        </button>

                        <button
                          type="button"
                          onClick={() => setDownloadModalVideo(video)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-white whitespace-nowrap"
                        >
                          {hasOffline ? (
                            <>
                              <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
                              Saved Offline
                            </>
                          ) : (
                            <>
                              <Download className="h-3.5 w-3.5" />
                              Download
                            </>
                          )}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* VIEW 2: NOW PLAYING THEATER */}
        {activeView === 'watch' && (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
            {/* Main Video Stage + Details */}
            <div className="space-y-4 lg:col-span-8">
              <PlayerStage
                video={currentVideo}
                offlineRecord={currentOfflineRecord}
                streamMode={streamMode}
                onChangeStreamMode={setStreamMode}
                isRecording={isRecording}
                recordingSeconds={recordingSeconds}
                onStopRecording={handleStopRecording}
              />

              {(currentVideo || currentOfflineRecord) && (
                <div className="space-y-4 border-t border-zinc-800 pt-4">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="space-y-1.5">
                      <h1 className="font-display text-xl font-semibold leading-snug text-white [text-wrap:balance]">
                        {activeWatchTitle}
                      </h1>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                        <span className="font-medium text-zinc-200">{activeWatchAuthor}</span>
                        {currentVideo && currentVideo.views > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">{formatViews(currentVideo.views)}</span>
                          </>
                        )}
                        {currentVideo?.uploaded && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{currentVideo.uploaded}</span>
                          </>
                        )}
                        {streamMode === 'offline' && currentOfflineRecord && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-emerald-400">
                              {formatBytes(currentOfflineRecord.sizeBytes)} local file
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      {currentVideo && (
                        <button
                          type="button"
                          onClick={() => setDownloadModalVideo(currentVideo)}
                          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 whitespace-nowrap"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download Offline Copy
                        </button>
                      )}

                      {streamMode === 'offline' && currentOfflineRecord && (
                        <button
                          type="button"
                          onClick={() =>
                            triggerDeviceBlobDownload(
                              currentOfflineRecord.blob,
                              `${sanitizeFileName(currentOfflineRecord.title)}.${
                                currentOfflineRecord.fileExtension
                              }`
                            )
                          }
                          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 whitespace-nowrap"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Export File
                        </button>
                      )}

                      {currentVideo && (
                        <a
                          href={currentVideo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-white whitespace-nowrap"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          YouTube
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Queue Rail */}
            <aside className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 lg:col-span-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <h2 className="font-display text-sm font-semibold text-white">Up Next</h2>
                <span className="font-mono text-xs text-zinc-400 tabular-nums">
                  {videos.length} videos
                </span>
              </div>

              <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
                {videos.map((item) => {
                  const isActive = currentVideo?.id === item.id && streamMode !== 'offline';
                  return (
                    <div
                      key={item.id}
                      className={`group flex items-start gap-3 rounded-lg p-2 transition-colors ${
                        isActive ? 'bg-zinc-800/80' : 'hover:bg-zinc-800/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handlePlayOnlineVideo(item)}
                        className="w-32 shrink-0"
                      >
                        <VideoThumbnail
                          src={item.thumbnail}
                          alt={item.title}
                          duration={item.duration}
                        />
                      </button>

                      <div className="min-w-0 flex-1 space-y-1">
                        <button
                          type="button"
                          onClick={() => handlePlayOnlineVideo(item)}
                          className="block w-full text-left"
                        >
                          <p className="line-clamp-2 text-xs font-medium leading-snug text-zinc-100">
                            {item.title}
                          </p>
                        </button>
                        <p className="truncate text-[11px] text-zinc-400">{item.author}</p>
                        <button
                          type="button"
                          onClick={() => setDownloadModalVideo(item)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-white"
                        >
                          <Download className="h-3 w-3" />
                          Save offline
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          </section>
        )}

        {/* VIEW 3: OFFLINE VAULT */}
        {activeView === 'vault' && (
          <OfflineVaultView
            records={offlineRecords}
            storageEstimate={storageEstimate}
            onPlayOffline={handlePlayOfflineRecord}
            onRefresh={refreshOfflineVault}
            onBrowseVideos={() => setActiveView('discover')}
          />
        )}
      </main>

      {/* Download & Offline Modal */}
      <DownloadModal
        video={downloadModalVideo}
        isOpen={Boolean(downloadModalVideo)}
        sessionCookie={sessionCookie}
        onSessionCookieChange={setSessionCookie}
        onClose={() => setDownloadModalVideo(null)}
        onSavedToVault={() => void refreshOfflineVault()}
        onStartBrowserCapture={handleStartBrowserCapture}
      />
    </div>
  );
}
