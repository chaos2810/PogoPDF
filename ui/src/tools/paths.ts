// Windows paths use backslashes; treat both separators as path boundaries.
export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const cut = normalized.lastIndexOf("/");
  return cut === -1 ? path : normalized.slice(cut + 1);
}

// Preserve the folder's own separator style; only add one when missing.
export function joinPath(folder: string, name: string): string {
  if (/[\\/]$/.test(folder)) return folder + name;
  const sep = folder.includes("\\") ? "\\" : "/";
  return folder + sep + name;
}
