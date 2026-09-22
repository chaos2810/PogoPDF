import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from "pdf-lib";
import { findPymupdfAssets, getPageWords } from "./textedit/pymupdf";
import { getPdfRenderer } from "./render/renderpdf";
import { extractPageText } from "./render/textextract";

const ENGINE_DIR = join(import.meta.dirname, "..");

async function makePdf(path: string, pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]);
  writeFileSync(path, await doc.save());
}

// Walk a page's /Annots low-level: raw get plus instanceof, no lookupMaybe.
function pageAnnots(doc: PDFDocument, pageIndex: number): PDFDict[] {
  const raw: unknown = doc.getPage(pageIndex).node.get(PDFName.of("Annots"));
  const arr = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  if (!(arr instanceof PDFArray)) return [];
  const out: PDFDict[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const entry = arr.get(i);
    const dict = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
    if (dict instanceof PDFDict) out.push(dict);
  }
  return out;
}

const children = new Set<ChildProcess>();

function startEngine(): ChildProcess {
  // Direct `node src/engine.ts` fails on extensionless relative imports under
  // Node's type stripping, so load tsx (resolved via the workspace root).
  const child = spawn(process.execPath, ["--import", "tsx", "src/engine.ts"], {
    cwd: ENGINE_DIR,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

// Resolves with the JSON-RPC response whose id matches expectedId. Progress
// notifications (no id) and other ids are buffered and ignored.
function rpcLine(child: ChildProcess, expectedId: number): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === expectedId) {
          cleanup();
          resolve(msg);
          return;
        }
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onExit = () => {
      cleanup();
      reject(new Error(`engine exited before responding to id ${expectedId}`));
    };
    const cleanup = () => {
      child.stdout!.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    child.stdout!.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

afterAll(() => {
  for (const child of children) child.kill();
});

describe("engine stdio smoke", () => {
  it("ping, merge a job, receive result", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogo-smoke-"));
    mkdirSync(join(work, "f"), { recursive: true });
    await makePdf(join(work, "f", "a.pdf"), 1);
    await makePdf(join(work, "f", "b.pdf"), 2);

    const child = startEngine();
    try {
      const pingPromise = rpcLine(child, 1);
      child.stdin!.write(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "engine.ping" }) + "\n"
      );
      const pong = await pingPromise;
      expect(pong.result.pong).toBe(true);

      const mergePromise = rpcLine(child, 2);
      child.stdin!.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "job.start",
          params: {
            jobId: "123e4567-e89b-12d3-a456-426614174000",
            toolId: "merge",
            input: {
              filePaths: [join(work, "f", "a.pdf"), join(work, "f", "b.pdf")],
            },
          },
        }) + "\n"
      );
      const result = await mergePromise;
      expect(result.result.jobId).toBe("123e4567-e89b-12d3-a456-426614174000");
      expect(result.result.outputPath).toBeTruthy();
      // pdf-lib treats a string as base64, so read the produced file as bytes.
      const outPath = result.result.outputPath as string;
      expect(existsSync(outPath)).toBe(true);
      const doc = await PDFDocument.load(readFileSync(outPath));
      expect(doc.getPageCount()).toBe(3);

      child.stdin!.end();
      await new Promise((r) => child.once("exit", r));
    } finally {
      child.kill();
    }
  }, 30000);

  it("split a job into multiple outputs", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogo-smoke-"));
    mkdirSync(join(work, "f"), { recursive: true });
    await makePdf(join(work, "f", "five.pdf"), 5);

    const child = startEngine();
    try {
      const splitPromise = rpcLine(child, 3);
      child.stdin!.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "job.start",
          params: {
            jobId: "223e4567-e89b-12d3-a456-426614174000",
            toolId: "split",
            input: {
              filePath: join(work, "f", "five.pdf"),
              mode: "ranges",
              ranges: "1-2,4,5",
            },
          },
        }) + "\n"
      );
      const result = await splitPromise;
      expect(result.result.jobId).toBe("223e4567-e89b-12d3-a456-426614174000");
      expect(result.result.outputPath).toBeUndefined();
      const outputPaths = result.result.outputPaths as string[];
      expect(Array.isArray(outputPaths)).toBe(true);
      expect(outputPaths).toHaveLength(3);
      const pageCounts: number[] = [];
      for (const p of outputPaths) {
        expect(existsSync(p)).toBe(true);
        pageCounts.push((await PDFDocument.load(readFileSync(p))).getPageCount());
      }
      expect(pageCounts).toEqual([2, 1, 1]);

      child.stdin!.end();
      await new Promise((r) => child.once("exit", r));
    } finally {
      child.kill();
    }
  }, 30000);

  it("returns a structured data result for viewMetadata", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogo-smoke-"));
    mkdirSync(join(work, "f"), { recursive: true });
    await makePdf(join(work, "f", "meta.pdf"), 2);

    const child = startEngine();
    try {
      const metaPromise = rpcLine(child, 5);
      child.stdin!.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "job.start",
          params: {
            jobId: "423e4567-e89b-12d3-a456-426614174000",
            toolId: "viewMetadata",
            input: { filePath: join(work, "f", "meta.pdf") },
          },
        }) + "\n"
      );
      const result = await metaPromise;
      expect(result.result.jobId).toBe("423e4567-e89b-12d3-a456-426614174000");
      expect(result.result.outputPath).toBeUndefined();
      expect(result.result.data.pageCount).toBe(2);

      child.stdin!.end();
      await new Promise((r) => child.once("exit", r));
    } finally {
      child.kill();
    }
  }, 30000);

  it("runs a previously-unregistered tool (editMetadata) end-to-end", async () => {
    // crop/editMetadata/removeMetadata had contracts + UI but no engine module;
    // job.start failed "Unknown tool". This exercises the full stdio path for one
    // of them and verifies the data-less {jobId, outputPath} result shape.
    const work = mkdtempSync(join(tmpdir(), "pogo-smoke-"));
    mkdirSync(join(work, "f"), { recursive: true });
    await makePdf(join(work, "f", "meta.pdf"), 1);

    const child = startEngine();
    try {
      const resp = rpcLine(child, 6);
      child.stdin!.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 6,
          method: "job.start",
          params: {
            jobId: "523e4567-e89b-12d3-a456-426614174000",
            toolId: "editMetadata",
            input: { filePath: join(work, "f", "meta.pdf"), title: "Smoke Title" },
          },
        }) + "\n"
      );
      const result = await resp;
      expect(result.error).toBeUndefined();
      expect(result.result.jobId).toBe("523e4567-e89b-12d3-a456-426614174000");
      expect(result.result.data).toBeUndefined();
      const outPath = result.result.outputPath as string;
      expect(outPath.endsWith("metadata.pdf")).toBe(true);
      expect(existsSync(outPath)).toBe(true);

      const doc = await PDFDocument.load(readFileSync(outPath), { updateMetadata: false });
      expect(doc.getTitle()).toBe("Smoke Title");

      child.stdin!.end();
      await new Promise((r) => child.once("exit", r));
    } finally {
      child.kill();
    }
  }, 30000);

  it("saves an annotation via editorSave and reloads it as a real /Annots entry", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogo-smoke-"));
    mkdirSync(join(work, "f"), { recursive: true });
    await makePdf(join(work, "f", "annot.pdf"), 1);

    const child = startEngine();
    try {
      const resp = rpcLine(child, 7);
      child.stdin!.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "job.start",
          params: {
            jobId: "623e4567-e89b-12d3-a456-426614174000",
            toolId: "editorSave",
            input: {
              filePath: join(work, "f", "annot.pdf"),
              annotations: [{ type: "rect", page: 1, rect: { x: 100, y: 120, w: 80, h: 40 } }],
            },
          },
        }) + "\n"
      );
      const result = await resp;
      expect(result.error).toBeUndefined();
      expect(result.result.jobId).toBe("623e4567-e89b-12d3-a456-426614174000");
      const outPath = result.result.outputPath as string;
      expect(outPath).toBeTruthy();
      expect(existsSync(outPath)).toBe(true);

      const doc = await PDFDocument.load(readFileSync(outPath));
      const annots = pageAnnots(doc, 0);
      expect(annots.length).toBeGreaterThan(0);

      child.stdin!.end();
      await new Promise((r) => child.once("exit", r));
    } finally {
      child.kill();
    }
  }, 30000);

  it("fills a form via formFill and reads the value back after reload", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogo-smoke-"));
    mkdirSync(join(work, "f"), { recursive: true });
    const srcPath = join(work, "f", "form.pdf");
    const blank = await PDFDocument.create();
    const page = blank.addPage([595.28, 841.89]);
    blank.getForm().createTextField("fullName").addToPage(page, {
      x: 40,
      y: 40,
      width: 200,
      height: 24,
    });
    writeFileSync(srcPath, await blank.save());

    const child = startEngine();
    try {
      const resp = rpcLine(child, 8);
      child.stdin!.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 8,
          method: "job.start",
          params: {
            jobId: "723e4567-e89b-12d3-a456-426614174000",
            toolId: "formFill",
            input: {
              filePath: srcPath,
              values: [{ name: "fullName", value: "Ada Lovelace" }],
            },
          },
        }) + "\n"
      );
      const result = await resp;
      expect(result.error).toBeUndefined();
      expect(result.result.jobId).toBe("723e4567-e89b-12d3-a456-426614174000");
      const outPath = result.result.outputPath as string;
      expect(outPath).toBeTruthy();
      expect(existsSync(outPath)).toBe(true);

      const doc = await PDFDocument.load(readFileSync(outPath));
      expect(doc.getForm().getTextField("fullName").getText()).toBe("Ada Lovelace");

      child.stdin!.end();
      await new Promise((r) => child.once("exit", r));
    } finally {
      child.kill();
    }
  }, 30000);

  // editText needs the PyMuPDF wasm assets; skip loudly when the package is not
  // installed rather than failing on an environment gap.
  const pymupdfAssets = findPymupdfAssets();

  it.skipIf(!pymupdfAssets)(
    "edits text end-to-end through the spawned engine",
    async () => {
      const work = mkdtempSync(join(tmpdir(), "pogo-smoke-"));
      mkdirSync(join(work, "f"), { recursive: true });
      const srcPath = join(work, "f", "text.pdf");
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([595.28, 841.89]);
      page.drawText("Hello Edit World", { x: 72, y: 700, size: 24, font });
      writeFileSync(srcPath, await doc.save());

      // The UI supplies the quad; here it comes from the same extractor the UI
      // would feed from mupdf, proving the schema quad maps onto the edit path.
      const word = (await getPageWords(new Uint8Array(readFileSync(srcPath)), 0)).find(
        (w) => w.text === "Edit"
      )!;

      const child = startEngine();
      try {
        const resp = rpcLine(child, 9);
        child.stdin!.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 9,
            method: "job.start",
            params: {
              jobId: "823e4567-e89b-12d3-a456-426614174000",
              toolId: "editText",
              input: {
                filePath: srcPath,
                edits: [
                  {
                    page: 1,
                    quad: {
                      x: word.x0,
                      y: word.y0,
                      w: word.x1 - word.x0,
                      h: word.y1 - word.y0,
                    },
                    newText: "Smoke",
                  },
                ],
              },
            },
          }) + "\n"
        );
        const result = await resp;
        expect(result.error).toBeUndefined();
        expect(result.result.jobId).toBe("823e4567-e89b-12d3-a456-426614174000");
        const outPath = result.result.outputPath as string;
        expect(outPath.endsWith("edited.pdf")).toBe(true);
        expect(existsSync(outPath)).toBe(true);

        const renderer = await getPdfRenderer(outPath);
        try {
          const text = await extractPageText(await renderer.getPage(0));
          expect(text.split(/\s+/)).toContain("Smoke");
          expect(text.split(/\s+/)).not.toContain("Edit");
        } finally {
          await renderer.close();
        }

        child.stdin!.end();
        await new Promise((r) => child.once("exit", r));
      } finally {
        child.kill();
      }
    },
    120000
  );

  it("rejects invalid tool input via the central job.start schema check", async () => {
    const child = startEngine();
    try {
      const resp = rpcLine(child, 4);
      child.stdin!.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "job.start",
          params: {
            jobId: "323e4567-e89b-12d3-a456-426614174000",
            toolId: "reverse",
            input: { nope: true },
          },
        }) + "\n"
      );
      const result = await resp;
      expect(result.error).toBeTruthy();
      expect(result.error.code).toBe(-32001); // TOOL_ERROR_CODES.INVALID_INPUT
      expect(result.result).toBeUndefined();

      child.stdin!.end();
      await new Promise((r) => child.once("exit", r));
    } finally {
      child.kill();
    }
  }, 30000);
});
