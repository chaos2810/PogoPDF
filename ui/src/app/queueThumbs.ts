import { renderPdfThumbs } from "./pdfthumbs";

// Queue cards only need the first page. Memoize per path (including failures) so
// a file queued in several places is never rendered twice; the path's content
// does not change while it stays in the queue.
const cache = new Map<string, Promise<string | null>>();

/**
 * First-page preview data URL for a queued file, or null when no preview is
 * available (image inputs land with the imagesToPdf picker; a failed render
 * degrades to the placeholder card).
 */
export function getQueueThumb(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit) return hit;
  const pending = (async () => {
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
