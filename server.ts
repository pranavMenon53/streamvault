import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import yts from 'yt-search';
import {
  chooseFormat,
  Quality,
  Ytdl,
  type VideoFormat,
  type VideoInfo,
} from '@distube/ytdl-core';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
]);

interface VideoMetadataPayload {
  id: string;
  title: string;
  author: string;
  authorUrl?: string;
  duration: string;
  seconds: number;
  views: number;
  uploaded?: string;
  thumbnail: string;
  description?: string;
  url: string;
}

function extractSafeVideoId(rawInput: unknown): string | null {
  if (typeof rawInput !== 'string') return null;
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 500) return null;

  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!ALLOWED_YOUTUBE_HOSTS.has(hostname)) {
      return null;
    }

    if (hostname === 'youtu.be') {
      const firstSegment = parsed.pathname.split('/').filter(Boolean)[0];
      return firstSegment && YOUTUBE_ID_REGEX.test(firstSegment) ? firstSegment : null;
    }

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
  } catch {
    return null;
  }

  return null;
}

function sanitizeDownloadFilename(rawTitle: string, ext: string): string {
  const safeBase =
    rawTitle
      .replace(/[^a-zA-Z0-9 ._-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'streamvault-video';
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '') || 'mp4';
  return `${safeBase}.${safeExt}`;
}

function createYtdlClient(requestCookie?: string): Ytdl {
  const effectiveCookie =
    typeof requestCookie === 'string' && requestCookie.trim().length > 0
      ? requestCookie.trim()
      : process.env.YT_COOKIE?.trim() || undefined;
  return new Ytdl(effectiveCookie ? { cookie: effectiveCookie } : undefined);
}

function isBotCheckError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes('not a bot') ||
    lower.includes('sign in to confirm') ||
    lower.includes('login_required') ||
    lower.includes('cookies')
  );
}

function formatDurationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function fetchBaselineMetadata(videoId: string): Promise<VideoMetadataPayload> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const result = await yts({ videoId });
    if (result && result.title) {
      return {
        id: videoId,
        title: result.title,
        author: result.author?.name || 'YouTube Creator',
        authorUrl: result.author?.url,
        duration: result.timestamp || formatDurationLabel(result.seconds || 0),
        seconds: result.seconds || 0,
        views: result.views || 0,
        uploaded: result.ago || undefined,
        thumbnail: result.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        description: result.description || '',
        url: canonicalUrl,
      };
    }
  } catch {
    // Fallback to oEmbed below
  }

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(6000) });
    if (resp.ok) {
      const data = (await resp.json()) as {
        title?: string;
        author_name?: string;
        author_url?: string;
        thumbnail_url?: string;
      };
      return {
        id: videoId,
        title: data.title || `YouTube Video (${videoId})`,
        author: data.author_name || 'YouTube Creator',
        authorUrl: data.author_url,
        duration: '0:00',
        seconds: 0,
        views: 0,
        thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: canonicalUrl,
      };
    }
  } catch {
    // Fallback to minimal payload
  }

  return {
    id: videoId,
    title: `YouTube Video (${videoId})`,
    author: 'YouTube Creator',
    duration: '0:00',
    seconds: 0,
    views: 0,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    url: canonicalUrl,
  };
}

function pickVideoAndAudioFormats(
  info: VideoInfo,
  requestedQuality: string
): {
  progressive?: VideoFormat;
  videoOnly?: VideoFormat;
  audioOnly?: VideoFormat;
} {
  const targetHeightMap: Record<string, number> = {
    highest: 2160,
    '1080p': 1080,
    '720p': 720,
    '480p': 480,
    '360p': 360,
  };
  const maxHeight = targetHeightMap[requestedQuality] ?? 720;

  const playable = info.formats.filter((f) => !f.isDrm && !f.isOtf && !f.isLive);

  // 1. Check for a progressive mp4 that matches the requested resolution closely
  const progressiveCandidates = playable
    .filter((f) => f.hasVideo && f.hasAudio && f.container === 'mp4')
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  const exactProgressive = progressiveCandidates.find(
    (f) => (f.height || 0) <= maxHeight && (f.height || 0) >= Math.min(maxHeight, 720)
  );
  if (exactProgressive && maxHeight <= 720) {
    return { progressive: exactProgressive };
  }

  // 2. Otherwise pick best video-only stream <= maxHeight (prefer h264/avc1 mp4 for fast copy muxing)
  const videoCandidates = playable
    .filter((f) => f.hasVideo && !f.hasAudio && (f.height || 0) <= maxHeight)
    .sort((a, b) => {
      const hDiff = (b.height || 0) - (a.height || 0);
      if (hDiff !== 0) return hDiff;
      const aMp4 = a.container === 'mp4' ? 1 : 0;
      const bMp4 = b.container === 'mp4' ? 1 : 0;
      if (bMp4 !== aMp4) return bMp4 - aMp4;
      return (b.bitrate || 0) - (a.bitrate || 0);
    });

  const audioCandidates = playable
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => {
      const aM4a = a.container === 'mp4' ? 1 : 0;
      const bM4a = b.container === 'mp4' ? 1 : 0;
      if (bM4a !== aM4a) return bM4a - aM4a;
      return (b.audioBitrate || 0) - (a.audioBitrate || 0);
    });

  if (videoCandidates[0] && audioCandidates[0]) {
    return { videoOnly: videoCandidates[0], audioOnly: audioCandidates[0] };
  }

  if (progressiveCandidates[0]) {
    return { progressive: progressiveCandidates[0] };
  }

  const fallback = chooseFormat(playable, { quality: Quality.Highest });
  return { progressive: fallback };
}

function createTempPath(ext: string): string {
  const baseDir = path.resolve(os.tmpdir());
  const fileName = `sv-${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/gi, '')}`;
  const resolved = path.resolve(baseDir, fileName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid temporary file path');
  }
  return resolved;
}

async function runFfmpegMux(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  videoContainer: string
): Promise<void> {
  const ffmpegBin = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : 'ffmpeg';
  const videoCodecArgs = videoContainer === 'mp4' ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast'];
  const args = [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    ...videoCodecArgs,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegBin, args, { shell: false });
    let stderrTail = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-1000);
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail}`));
      }
    });
  });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', ffmpegAvailable: fs.existsSync('/usr/bin/ffmpeg') });
  });

  app.get('/api/search', async (req: Request, res: Response) => {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const query = rawQuery.slice(0, 200) || 'Blender Foundation open movies 4K';

    try {
      const directId = extractSafeVideoId(query);
      if (directId) {
        const video = await fetchBaselineMetadata(directId);
        res.json({ videos: [video] });
        return;
      }

      const searchResults = await yts(query);
      const videos: VideoMetadataPayload[] = searchResults.videos
        .filter((v) => v.videoId && YOUTUBE_ID_REGEX.test(v.videoId))
        .slice(0, 18)
        .map((v) => ({
          id: v.videoId,
          title: v.title,
          author: v.author?.name || 'YouTube Creator',
          authorUrl: v.author?.url,
          duration: v.timestamp || formatDurationLabel(v.seconds || 0),
          seconds: v.seconds || 0,
          views: v.views || 0,
          uploaded: v.ago || undefined,
          thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
          description: v.description || '',
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
        }));

      res.json({ videos });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/video-info', async (req: Request, res: Response) => {
    const { urlOrId, cookie } = (req.body ?? {}) as {
      urlOrId?: unknown;
      cookie?: unknown;
    };

    const videoId = extractSafeVideoId(urlOrId);
    if (!videoId) {
      res.status(400).json({ error: 'Please provide a valid YouTube video URL or 11-character video ID.' });
      return;
    }

    try {
      const baseline = await fetchBaselineMetadata(videoId);
      const safeCookie = typeof cookie === 'string' ? cookie : undefined;
      const ytdl = createYtdlClient(safeCookie);

      try {
        const info = await ytdl.getInfo(baseline.url);
        const playable = info.formats.filter((f) => !f.isDrm && !f.isOtf && !f.isLive);
        const formats = playable
          .filter((f) => f.hasVideo || f.hasAudio)
          .map((f) => ({
            itag: f.itag,
            qualityLabel: f.qualityLabel || (f.hasAudio && !f.hasVideo ? `${f.audioBitrate || 128}kbps Audio` : 'Standard'),
            container: f.container,
            hasVideo: f.hasVideo,
            hasAudio: f.hasAudio,
            filesize: f.contentLength,
            codecs: f.codecs,
          }));

        res.json({
          video: {
            ...baseline,
            title: info.videoDetails.title || baseline.title,
            author: info.videoDetails.author?.name || baseline.author,
            seconds: Number(info.videoDetails.lengthSeconds) || baseline.seconds,
            duration: formatDurationLabel(Number(info.videoDetails.lengthSeconds) || baseline.seconds),
            views: Number(info.videoDetails.viewCount) || baseline.views,
            description: info.videoDetails.description || baseline.description,
          },
          directDownloadAvailable: true,
          botCheckRequired: false,
          formats,
        });
      } catch (err) {
        const botBlocked = isBotCheckError(err);
        res.json({
          video: baseline,
          directDownloadAvailable: false,
          botCheckRequired: botBlocked,
          botCheckMessage: botBlocked
            ? 'YouTube asked this cloud server to verify a session cookie for direct MP4 extraction. You can still stream the video normally and capture an offline copy directly in your browser, or supply an optional YouTube cookie.'
            : err instanceof Error
              ? err.message
              : 'Direct format lookup unavailable',
          formats: [],
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load video metadata';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/stream/:id', async (req: Request, res: Response) => {
    const videoId = extractSafeVideoId(req.params.id);
    if (!videoId) {
      res.status(400).json({ error: 'Invalid YouTube video ID' });
      return;
    }

    try {
      const ytdl = createYtdlClient();
      const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
      const format = chooseFormat(
        info.formats.filter((f) => f.hasVideo && f.hasAudio && f.container === 'mp4' && !f.isDrm && !f.isOtf),
        { quality: Quality.Highest }
      );

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'none');
      if (format.contentLength) {
        res.setHeader('Content-Length', String(format.contentLength));
      }

      const stream = ytdl.download(info, { format });
      req.on('close', () => {
        stream.destroy();
      });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(502).end();
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (err) {
      const botBlocked = isBotCheckError(err);
      res.status(botBlocked ? 403 : 500).json({
        error: botBlocked ? 'YOUTUBE_BOT_CHECK' : 'STREAM_UNAVAILABLE',
        message: err instanceof Error ? err.message : 'Stream failed',
      });
    }
  });

  app.post('/api/download', async (req: Request, res: Response) => {
    const { videoId: rawId, format: requestedType, quality: requestedQuality, cookie } = (req.body ??
      {}) as {
      videoId?: unknown;
      format?: unknown;
      quality?: unknown;
      cookie?: unknown;
    };

    const videoId = extractSafeVideoId(rawId);
    if (!videoId) {
      res.status(400).json({ error: 'Invalid YouTube video ID.' });
      return;
    }

    const downloadType = requestedType === 'audio' ? 'audio' : 'mp4';
    const qualityKey =
      typeof requestedQuality === 'string' &&
      ['highest', '1080p', '720p', '480p', '360p'].includes(requestedQuality)
        ? requestedQuality
        : '720p';

    const tempFiles: string[] = [];
    const cleanupTempFiles = async () => {
      await Promise.all(
        tempFiles.map((filePath) =>
          fsp.unlink(filePath).catch(() => {
            // ignore cleanup errors
          })
        )
      );
    };

    try {
      const safeCookie = typeof cookie === 'string' ? cookie : undefined;
      const ytdl = createYtdlClient(safeCookie);
      const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
      const videoTitle = info.videoDetails.title || `video-${videoId}`;

      if (downloadType === 'audio') {
        const audioFormats = info.formats
          .filter((f) => f.hasAudio && !f.hasVideo && !f.isDrm && !f.isOtf && !f.isLive)
          .sort((a, b) => {
            const aM4a = a.container === 'mp4' ? 1 : 0;
            const bM4a = b.container === 'mp4' ? 1 : 0;
            if (bM4a !== aM4a) return bM4a - aM4a;
            return (b.audioBitrate || 0) - (a.audioBitrate || 0);
          });

        const selectedAudio = audioFormats[0] || chooseFormat(info.formats, { quality: Quality.HighestAudio });
        const ext = selectedAudio.container === 'mp4' ? 'm4a' : selectedAudio.container || 'webm';
        const filename = sanitizeDownloadFilename(videoTitle, ext);

        res.setHeader('Content-Type', selectedAudio.container === 'mp4' ? 'audio/mp4' : 'audio/webm');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-File-Name', filename);
        res.setHeader('X-Mime-Type', selectedAudio.container === 'mp4' ? 'audio/mp4' : 'audio/webm');
        if (selectedAudio.contentLength) {
          res.setHeader('Content-Length', String(selectedAudio.contentLength));
        }

        const stream = ytdl.download(info, { format: selectedAudio });
        res.on('close', () => stream.destroy());
        await pipeline(stream, res);
        return;
      }

      const selection = pickVideoAndAudioFormats(info, qualityKey);

      if (selection.progressive) {
        const filename = sanitizeDownloadFilename(videoTitle, 'mp4');
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-File-Name', filename);
        res.setHeader('X-Mime-Type', 'video/mp4');
        if (selection.progressive.contentLength) {
          res.setHeader('Content-Length', String(selection.progressive.contentLength));
        }

        const stream = ytdl.download(info, { format: selection.progressive });
        res.on('close', () => stream.destroy());
        await pipeline(stream, res);
        return;
      }

      if (selection.videoOnly && selection.audioOnly) {
        const videoTmp = createTempPath(selection.videoOnly.container || 'mp4');
        const audioTmp = createTempPath(selection.audioOnly.container || 'm4a');
        const outTmp = createTempPath('mp4');
        tempFiles.push(videoTmp, audioTmp, outTmp);

        const videoStream = ytdl.download(info, { format: selection.videoOnly });
        const audioStream = ytdl.download(info, { format: selection.audioOnly });

        await Promise.all([
          pipeline(videoStream, fs.createWriteStream(videoTmp)),
          pipeline(audioStream, fs.createWriteStream(audioTmp)),
        ]);

        await runFfmpegMux(videoTmp, audioTmp, outTmp, selection.videoOnly.container || 'mp4');

        const stat = await fsp.stat(outTmp);
        const filename = sanitizeDownloadFilename(videoTitle, 'mp4');
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', String(stat.size));
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-File-Name', filename);
        res.setHeader('X-Mime-Type', 'video/mp4');

        const outStream = fs.createReadStream(outTmp);
        res.on('close', () => {
          outStream.destroy();
          void cleanupTempFiles();
        });
        await pipeline(outStream, res);
        await cleanupTempFiles();
        return;
      }

      res.status(404).json({ error: 'No downloadable format was found for this video.' });
    } catch (err) {
      await cleanupTempFiles();
      if (res.headersSent) {
        res.end();
        return;
      }
      if (isBotCheckError(err)) {
        res.status(403).json({
          error: 'YOUTUBE_BOT_CHECK',
          message:
            'YouTube blocked automated download from this cloud IP. Use Browser Tab Capture to save an offline copy without cookies, or provide an optional YouTube session cookie.',
        });
        return;
      }
      res.status(500).json({
        error: 'DOWNLOAD_FAILED',
        message: err instanceof Error ? err.message : 'Download failed',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StreamVault server listening on http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
