import { useEffect, useState } from 'react';
import { loadImage, onImage } from '@/lib/assetstore';

// Each kept reference image as an object URL, made once.
const urls = new Map<string, string>();

/** The URL of a kept reference image (null until it is at hand, or without one). */
export function useReferenceUrl(id: string | undefined): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!id || urls.has(id)) return;
    let live = true;
    const load = () => loadImage(id).then((image) => {
      if (!image || !live || urls.has(id)) return;
      urls.set(id, URL.createObjectURL(image));
      bump((n) => n + 1);
    });
    void load();
    // It may come later (synced from the account).
    const off = onImage((got) => { if (got === id) void load(); });
    return () => { live = false; off(); };
  }, [id]);
  return id ? urls.get(id) ?? null : null;
}
