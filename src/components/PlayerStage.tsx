import { useEffect, useState } from 'react';
import { AlertCircle, HardDrive, MonitorPlay, Square } from 'lucide-react';
import { formatDurationSeconds } from '../lib/youtubeUrl';
import type { OfflineVideoRecord, VideoItem } from '../types/video';

export type StreamMode = 'youtube' | 'direct' | 'offline';

interface PlayerStageProps {
  video: VideoItem | null;
  offlineRecord?: OfflineVideoRecord | null;
  streamMode: StreamMode;
  onChangeStreamMode: (mode: StreamMode) => void;
  isRecording: boolean;
  recordingSeconds: number;
  onStopRecording: () => void;
}

export function PlayerStage({
  video,
  offlineRecord,
  streamMode,
  onChangeStreamMode,
  isRecording,
  recordingSeconds,
  onStopRecording,
}: PlayerStageProps) {
  const [offlineObjectUrl, setOfflineObjectUrl] = useState<string | null>(null);
  const [directStreamError, setDirectStreamError] = useState<string | null>(null);

  useEffect(() => {
    setDirectStreamError(null);
  }, [video?.id, streamMode]);

  useEffect(() => {
    if (streamMode === 'offline' && offlineRecord?.blob) {
      const url = URL.createObjectURL(offlineRecord.blob);
      setOfflineObjectUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
    setOfflineObjectUrl(null);
    return undefined;
  }, [streamMode, offlineRecord]);

  if (!video && !offlineRecord) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <MonitorPlay className="mb-3 h-10 w-10 text-zinc-500" />
        <p className="font-display text-lg font-semibold text-zinc-200">
          Select a video or paste any YouTube link
        </p>
        <p className="mt-1 max-w-md text-sm text-zinc-400">
          Stream directly in the player or save an offline copy to your device and Offline Vault.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-800 bg-black">
        {streamMode === 'offline' && offlineObjectUrl ? (
          <video
            key={offlineObjectUrl}
            src={offlineObjectUrl}
            controls
            autoPlay
            playsInline
            className="h-full w-full bg-black"
          />
        ) : streamMode === 'direct' && video ? (
          directStreamError ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-zinc-950 p-6 text-center">
              <AlertCircle className="h-8 w-8 text-amber-500" />
              <div className="max-w-md space-y-1">
                <p className="text-sm font-medium text-zinc-200">
                  Direct server stream was blocked by YouTube on this host
                </p>
                <p className="text-xs text-zinc-400">{directStreamError}</p>
              </div>
              <button
                type="button"
                onClick={() => onChangeStreamMode('youtube')}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-red-500 whitespace-nowrap shrink-0"
              >
                Switch to YouTube Player
              </button>
            </div>
          ) : (
            <video
              key={`direct-${video.id}`}
              src={`/api/stream/${video.id}`}
              controls
              autoPlay
              playsInline
              onError={() =>
                setDirectStreamError(
                  'YouTube requires a browser embed or session cookie from cloud IP addresses.'
                )
              }
              className="h-full w-full bg-black"
            />
          )
        ) : video ? (
          <iframe
            key={`yt-${video.id}`}
            src={`https://www.youtube.com/embed/${video.id}?autoplay=1&rel=0&modestbranding=1`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="h-full w-full border-0"
          />
        ) : null}
      </div>

      {/* Active recording bar or playback source selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isRecording ? (
          <div className="flex w-full items-center justify-between gap-4 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-2.5">
            <div className="flex items-center gap-3 text-sm text-red-200">
              <span className="font-medium">Capturing offline copy from tab</span>
              <span aria-hidden="true" className="text-red-500">
                ·
              </span>
              <span className="font-mono text-xs tabular-nums text-red-100">
                {formatDurationSeconds(recordingSeconds)}
              </span>
            </div>
            <button
              type="button"
              onClick={onStopRecording}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500 whitespace-nowrap shrink-0"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop & Save Copy
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
              {video && (
                <>
                  <button
                    type="button"
                    onClick={() => onChangeStreamMode('youtube')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      streamMode === 'youtube'
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    YouTube Player
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeStreamMode('direct')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      streamMode === 'direct'
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Direct Stream
                  </button>
                </>
              )}
              {offlineRecord && (
                <button
                  type="button"
                  onClick={() => onChangeStreamMode('offline')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    streamMode === 'offline'
                      ? 'bg-emerald-600/20 text-emerald-300'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <HardDrive className="h-3.5 w-3.5" />
                  Offline Copy
                </button>
              )}
            </div>

            {streamMode === 'offline' && offlineRecord && (
              <span className="text-xs text-emerald-400">
                Playing local copy from your Offline Vault
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
