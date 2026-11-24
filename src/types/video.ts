export interface VideoItem {
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

export interface VideoFormatOption {
  itag: number;
  qualityLabel: string;
  container: string;
  hasVideo: boolean;
  hasAudio: boolean;
  filesize?: number;
  codecs?: string;
}

export interface VideoDetailsResponse {
  video: VideoItem;
  directDownloadAvailable: boolean;
  botCheckRequired: boolean;
  botCheckMessage?: string;
  formats: VideoFormatOption[];
}

export interface OfflineVideoRecord {
  id: string;
  title: string;
  author: string;
  duration: string;
  seconds: number;
  thumbnailDataUrl?: string;
  mimeType: string;
  fileExtension: string;
  sizeBytes: number;
  qualityLabel: string;
  savedAt: number;
  blob: Blob;
}
