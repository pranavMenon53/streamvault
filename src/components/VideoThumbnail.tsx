import { useState } from 'react';
import { Film } from 'lucide-react';

interface VideoThumbnailProps {
  src?: string;
  alt: string;
  duration?: string;
  className?: string;
}

export function VideoThumbnail({ src, alt, duration, className = '' }: VideoThumbnailProps) {
  const [hasError, setHasError] = useState(false);

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-lg bg-zinc-900 border border-zinc-800/80 ${className}`}
    >
      {src && !hasError ? (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setHasError(true)}
          className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 text-zinc-500">
          <Film className="h-7 w-7 opacity-60" />
          <span className="max-w-[85%] truncate px-2 text-xs text-zinc-400">{alt}</span>
        </div>
      )}

      {duration && duration !== '0:00' && (
        <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] font-medium text-zinc-100 tabular-nums">
          {duration}
        </span>
      )}
    </div>
  );
}
