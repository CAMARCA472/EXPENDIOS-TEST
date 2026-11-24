import React, { useEffect, useState } from 'react';
import { getStoredPhoto } from '../lib/photoStorageDB';

export function AuthenticatedImage({
  src,
  alt,
  className,
  crossOrigin,
  onClick,
  onError,
  onLoad,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  crossOrigin?: string;
  onClick?: () => void;
  onError?: () => void;
  onLoad?: () => void;
}) {
  const [error, setError] = useState(false);
  const [offlineFallbackUrl, setOfflineFallbackUrl] = useState<string | null>(null);
  const [cacheBuster, setCacheBuster] = useState(0);

  useEffect(() => {
    const handleCacheCleared = () => {
      setError(false);
      setOfflineFallbackUrl(null);
      setCacheBuster((prev) => prev + 1);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('camarca_cache_cleared', handleCacheCleared);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('camarca_cache_cleared', handleCacheCleared);
      }
    };
  }, []);

  useEffect(() => {
    setError(false);
    setOfflineFallbackUrl((prev) => {
      if (prev && prev.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(prev);
        } catch {}
      }
      return null;
    });
  }, [src, cacheBuster]);

  useEffect(() => {
    return () => {
      if (offlineFallbackUrl && offlineFallbackUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(offlineFallbackUrl);
        } catch {}
      }
    };
  }, [offlineFallbackUrl]);

  if (!src || typeof src !== 'string' || !src.trim()) {
    return <div className={`bg-slate-200/50 ${className || ''}`} />;
  }

  const trimmed = src.trim();

  // Construir URL directa liviana sin retener Blobs ni Base64 en memoria V8
  let resolvedUrl = offlineFallbackUrl || trimmed;
  if (!offlineFallbackUrl && (trimmed.startsWith('/api/photos/') || trimmed.startsWith('/api/expendio/photo/'))) {
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('camarca_token') || localStorage.getItem('camarca_token')
        : null;
    const sep = trimmed.includes('?') ? '&' : '?';
    const tokenParam = token && !trimmed.includes('token=') ? `token=${encodeURIComponent(token)}` : '';
    const cbParam = cacheBuster > 0 ? `_cb=${cacheBuster}` : '';
    const queryAddon = [tokenParam, cbParam].filter(Boolean).join('&');
    resolvedUrl = queryAddon ? `${trimmed}${sep}${queryAddon}` : trimmed;
  }

  const handleImgError = async () => {
    // Intentar recuperación desde IndexedDB únicamente si falla la red o estamos offline
    if (!offlineFallbackUrl && (trimmed.startsWith('/api/photos/') || trimmed.startsWith('/api/expendio/photo/'))) {
      try {
        const cleanPath = trimmed.split('?')[0];
        const parts = cleanPath.split('/');
        const isExpendioRoute = trimmed.startsWith('/api/expendio/photo/');
        const cedulaParam = decodeURIComponent(parts[isExpendioRoute ? 4 : 3] || '');
        const slotKeyParam = decodeURIComponent(parts[isExpendioRoute ? 5 : 4] || '');
        if (cedulaParam && slotKeyParam) {
          const normCed = cedulaParam.replace(/\D/g, '');
          const cached =
            (await getStoredPhoto(cedulaParam, slotKeyParam)) ||
            (normCed && normCed !== cedulaParam ? await getStoredPhoto(normCed, slotKeyParam) : undefined);
          if (cached?.blob && cached.blob.size > 200) {
            setOfflineFallbackUrl(URL.createObjectURL(cached.blob));
            return;
          }
          if (cached?.dataUrl) {
            setOfflineFallbackUrl(cached.dataUrl);
            return;
          }
        }
      } catch {}
    }
    setError(true);
    if (onError) onError();
  };

  if (error) {
    return (
      <div className={`bg-slate-200 flex items-center justify-center ${className || ''}`}>
        <span className="text-slate-400 text-xs">Sin imagen</span>
      </div>
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt || 'Fotografía'}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      crossOrigin={crossOrigin as any}
      onClick={onClick}
      onLoad={onLoad}
      onError={handleImgError}
    />
  );
}
