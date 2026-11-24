import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Download,
  HardDrive,
  Play,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  deleteOfflineVideo,
  saveOfflineVideo,
  triggerDeviceBlobDownload,
} from '../lib/offlineDb';
import { formatBytes, sanitizeFileName } from '../lib/youtubeUrl';
import type { OfflineVideoRecord } from '../types/video';
import { VideoThumbnail } from './VideoThumbnail';

interface OfflineVaultViewProps {
  records: OfflineVideoRecord[];
  storageEstimate: { usedBytes: number; quotaBytes: number };
  onPlayOffline: (record: OfflineVideoRecord) => void;
  onRefresh: () => void;
  onBrowseVideos: () => void;
}

export function OfflineVaultView({
  records,
  storageEstimate,
  onPlayOffline,
  onRefresh,
  onBrowseVideos,
}: OfflineVaultViewProps) {
  const [filterQuery, setFilterQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalSavedBytes = useMemo(
    () => records.reduce((sum, item) => sum + item.sizeBytes, 0),
    [records]
  );

  const filteredRecords = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.author.toLowerCase().includes(q) ||
        item.qualityLabel.toLowerCase().includes(q)
    );
  }, [records, filterQuery]);

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await deleteOfflineVideo(id);
      onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
    const title = file.name.replace(/\.[^/.]+$/, '');
    await saveOfflineVideo({
      id: `local-${Date.now()}`,
      title,
      author: 'Imported Local File',
      duration: '0:00',
      seconds: 0,
      mimeType: file.type || 'video/mp4',
      fileExtension: ext,
      sizeBytes: file.size,
      qualityLabel: 'Local',
      savedAt: Date.now(),
      blob: file,
    });
    event.target.value = '';
    onRefresh();
  };

  return (
    <div className="space-y-6">
      {/* Header & Storage Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
            Offline Vault
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            <span className="font-mono tabular-nums text-zinc-200">{records.length}</span>{' '}
            {records.length === 1 ? 'copy' : 'copies'} stored on this device
            <span aria-hidden="true" className="mx-2 text-zinc-600">
              ·
            </span>
            <span className="font-mono tabular-nums text-zinc-200">
              {formatBytes(totalSavedBytes)}
            </span>{' '}
            saved
            {storageEstimate.quotaBytes > 0 && (
              <>
                <span aria-hidden="true" className="mx-2 text-zinc-600">
                  ·
                </span>
                <span className="font-mono tabular-nums text-zinc-400">
                  {formatBytes(storageEstimate.quotaBytes)} browser quota
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800 whitespace-nowrap shrink-0"
          >
            <Upload className="h-3.5 w-3.5" />
            Import Local File
          </button>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-16 text-center">
          <HardDrive className="mb-3 h-10 w-10 text-zinc-500" />
          <h2 className="font-display text-lg font-semibold text-zinc-100">
            No offline copies saved yet
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-zinc-400">
            When you download or capture a YouTube video, choose Save to Offline Vault to keep a playable local copy right on your device.
          </p>
          <button
            type="button"
            onClick={onBrowseVideos}
            className="mt-5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 whitespace-nowrap"
          >
            Browse Videos to Save
          </button>
        </div>
      ) : (
        <>
          {/* Filter bar */}
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter saved videos..."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pr-3 pl-9 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {filteredRecords.length === 0 ? (
            <p className="py-8 text-sm text-zinc-400">No saved videos match "{filterQuery}".</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredRecords.map((item) => (
                <div
                  key={item.id}
                  className="group flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 transition-colors hover:border-zinc-700"
                >
                  <div>
                    <button
                      type="button"
                      onClick={() => onPlayOffline(item)}
                      className="w-full text-left"
                    >
                      <VideoThumbnail
                        src={item.thumbnailDataUrl}
                        alt={item.title}
                        duration={item.duration}
                      />
                    </button>

                    <div className="mt-3 space-y-1">
                      <h3 className="line-clamp-2 text-sm font-semibold text-zinc-100">
                        {item.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                        <span>{item.author}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{item.qualityLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{formatBytes(item.sizeBytes)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-3">
                    <button
                      type="button"
                      onClick={() => onPlayOffline(item)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 whitespace-nowrap"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      Play Offline
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          triggerDeviceBlobDownload(
                            item.blob,
                            `${sanitizeFileName(item.title)}.${item.fileExtension}`
                          )
                        }
                        title="Save file to Downloads folder"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-white whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export
                      </button>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => handleDelete(item.id)}
                        title="Delete from Offline Vault"
                        aria-label={`Delete ${item.title}`}
                        className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 transition-colors hover:border-red-900/70 hover:bg-red-950/40 hover:text-red-300 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
