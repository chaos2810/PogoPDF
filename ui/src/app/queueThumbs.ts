import { convertFileSrc } from "@tauri-apps/api/core";
import { renderPdfThumbs } from "./pdfthumbs";

// Queue cards only need the first page. Memoize per path (including failures) so
// a file queued in several places is never rendered twice; the path's content
// does not change while it stays in the queue.
const cache = new Map<string, Promise<string | null>>();

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/i;

/**
 * Preview src for a queued file: image files resolve straight to their asset
 * URL (no decode needed), PDFs to a rendered first-page data URL, and anything
 * else to null (the placeholder card).
 */
export function getQueueThumb(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit) return hit;
  const pending = (async () => {
    if (IMAGE_RE.test(path)) return convertFileSrc(path);
    if (!/\.pdf$/i.test(path)) return null;
    try {
      const thumbs = await renderPdfThumbs(path, 1);
      return thumbs[0]?.dataUrl ?? null;
    } catch {
      return null;
    }
  })();
  cache.set(path, pending);
  return pending;
}
