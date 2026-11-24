const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    if (hostname === 'youtu.be') {
      const candidate = parsed.pathname.split('/').filter(Boolean)[0];
      return candidate && YOUTUBE_ID_REGEX.test(candidate) ? candidate : null;
    }

    if (
      hostname === 'youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'music.youtube.com' ||
      hostname === 'youtube-nocookie.com'
    ) {
      const vParam = parsed.searchParams.get('v');
      if (vParam && YOUTUBE_ID_REGEX.test(vParam)) {
        return vParam;
      }

      const segments = parsed.pathname.split('/').filter(Boolean);
      if (
        segments.length >= 2 &&
        ['embed', 'shorts', 'live', 'v'].includes(segments[0]) &&
        YOUTUBE_ID_REGEX.test(segments[1])
      ) {
        return segments[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function isLikelyYouTubeUrl(input: string): boolean {
  return extractYouTubeVideoId(input) !== null;
}

export function formatViews(views: number): string {
  if (!Number.isFinite(views) || views <= 0) return '0 views';
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B views`;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M views`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K views`;
  return `${views.toLocaleString()} views`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatDurationSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00';
  const secs = Math.floor(totalSeconds);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 80) || 'streamvault-video';
}
