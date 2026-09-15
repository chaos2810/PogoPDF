export class PageSelectionError extends Error {
  code = -32001; // INVALID_INPUT parity
  constructor(msg: string) { super(msg); this.name = "PageSelectionError"; }
}

export function parsePageSelection(spec: string, pageCount: number): number[] {
  const trimmed = spec.trim();
  if (!trimmed) throw new PageSelectionError("Empty page selection");
  const out = new Set<number>();
  for (const token of trimmed.split(",")) {
    const t = token.trim();
    if (!t) throw new PageSelectionError(`Empty page token in "${spec}"`);
    const m = /^(\d+)(?:-(\d+))?$/.exec(t);
    if (!m) throw new PageSelectionError(`Invalid page token "${t}"`);
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end < start || end > pageCount) {
      throw new PageSelectionError(`Page ${t} out of range (1-${pageCount})`);
    }
    for (let p = start; p <= end; p++) out.add(p - 1);
  }
  return [...out].sort((a, b) => a - b);
}
