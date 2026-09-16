import { basename, extname } from "node:path";
import { SplitInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled, buildFromPages, invalidInput } from "./organize";

// Split output documents: one per token/range/chunk. Each group is a list of
// 0-based source page indices.
// Ranges mode preserves token order (NOT ascending-normalized across tokens):
// "5,1-3" → document 1 = page 5, document 2 = pages 1-3.
function rangeGroups(spec: string, pageCount: number): number[][] {
  const tokens = spec.split(",");
  const groups: number[][] = [];
  for (const token of tokens) {
    const t = token.trim();
    if (!t) throw invalidInput(`Empty page token in "${spec}"`);
    groups.push(parsePageSelection(t, pageCount));
  }
  return groups;
}

function everyGroups(pageCount: number, every: number): number[][] {
  const groups: number[][] = [];
  for (let start = 0; start < pageCount; start += every) {
    const group: number[] = [];
    for (let i = start; i < Math.min(start + every, pageCount); i++) group.push(i);
    groups.push(group);
  }
  return groups;
}

function singleGroups(pageCount: number): number[][] {
  return Array.from({ length: pageCount }, (_, i) => [i]);
}

export async function runSplit(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string[]> {
  const { filePath, mode, ranges, every, filePrefix } =
    SplitInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const pageCount = src.getPageCount();

  let groups: number[][];
  if (mode === "ranges") {
    if (ranges === undefined || !ranges.trim()) {
      throw invalidInput("ranges is required when mode is ranges");
    }
    groups = rangeGroups(ranges, pageCount);
  } else if (mode === "every") {
    if (every === undefined) {
      throw invalidInput("every is required when mode is every");
    }
    groups = everyGroups(pageCount, every);
  } else {
    groups = singleGroups(pageCount);
  }

  const trimmedPrefix = filePrefix?.trim();
  const prefix = trimmedPrefix
    ? trimmedPrefix
    : basename(filePath, extname(filePath));
  const out: string[] = [];
  for (let n = 0; n < groups.length; n++) {
    assertNotCancelled(ctx);
    const doc = await buildFromPages(
      src,
      groups[n].map((index) => ({ index }))
    );
    out.push(await savePdf(doc, outDir, `${prefix}-${n + 1}.pdf`));
  }
  return out;
}
