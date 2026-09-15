// Windows paths use backslashes; treat both separators as path boundaries.
export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const cut = normalized.lastIndexOf("/");
  return cut === -1 ? path : normalized.slice(cut + 1);
}
