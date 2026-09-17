import { describe, it, expect, vi, afterAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  AddAttachmentsInputSchema,
  TOOL_ERROR_CODES,
  type ProgressParams,
} from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { createDispatcher } from "../../rpc/dispatcher";
import { encryptedPdfBytes, makePdf } from "../../testing/fixtures";
import { registerTools } from "../registry";
import { registerAttachmentsList } from "../../bootstrap";
import { listEmbeddedFiles } from "./embeddedfiles";
import { runAddAttachments, runEditAttachments, runExtractAttachments } from "./attachments";

const scratch: string[] = [];

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-attach-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const okCtx: RpcCtx = { cancelled: () => false, notifyProgress: () => {} };

function makeAttachment(path: string, bytes: Buffer): string {
  writeFileSync(path, bytes);
  return path;
}

async function loadAttachmentNames(path: string): Promise<string[]> {
  const doc = await PDFDocument.load(readFileSync(path));
  return listEmbeddedFiles(doc).map((a) => a.name);
}

describe("runAddAttachments", () => {
  it("embeds each file and reports its name and size", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "src.pdf"), 1);
    const a = makeAttachment(join(dir, "one.txt"), Buffer.from("hello attachment one"));
    const b = makeAttachment(join(dir, "two.bin"), Buffer.from("second file bytes!"));

    const out = await runAddAttachments({ filePath: src, attachments: [a, b] }, okCtx, dir);
    expect(out).toBe(join(dir, "attachments.pdf"));

    const doc = await PDFDocument.load(readFileSync(out));
    const listed = listEmbeddedFiles(doc).sort((x, y) => x.name.localeCompare(y.name));
    expect(listed).toEqual([
      { name: "one.txt", size: Buffer.byteLength("hello attachment one") },
      { name: "two.bin", size: Buffer.byteLength("second file bytes!") },
    ]);
  });

  it("reports progress to 100", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "src.pdf"), 1);
    const a = makeAttachment(join(dir, "one.txt"), Buffer.from("aaa"));
    const events: ProgressParams[] = [];
    await runAddAttachments(
      { filePath: src, attachments: [a] },
      { cancelled: () => false, notifyProgress: (p) => events.push(p) },
      dir
    );
    expect(events.at(-1)?.percent).toBe(100);
  });

  it("names a missing attachment with CORRUPT_PDF", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "src.pdf"), 1);
    await expect(
      runAddAttachments({ filePath: src, attachments: [join(dir, "nope.txt")] }, okCtx, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CORRUPT_PDF });
  });

  it("maps an encrypted source to ENCRYPTED_PDF", async () => {
    const dir = outDir();
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    const a = makeAttachment(join(dir, "one.txt"), Buffer.from("aaa"));
    await expect(
      runAddAttachments({ filePath: enc, attachments: [a] }, okCtx, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.ENCRYPTED_PDF });
  });

  it("throws CANCELLED when cancelled at entry", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "src.pdf"), 1);
    const a = makeAttachment(join(dir, "one.txt"), Buffer.from("aaa"));
    await expect(
      runAddAttachments({ filePath: src, attachments: [a] }, { ...okCtx, cancelled: () => true }, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});

describe("AddAttachmentsInputSchema", () => {
  it("rejects more than 50 attachments", () => {
    const files = Array.from({ length: 51 }, (_, i) => `f${i}.txt`);
    const parsed = AddAttachmentsInputSchema.safeParse({ filePath: "a.pdf", attachments: files });
    expect(parsed.success).toBe(false);
  });
});

describe("runExtractAttachments", () => {
  it("extracts embedded files byte-equal to the inputs", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "src.pdf"), 1);
    const one = Buffer.from("hello attachment one");
    const two = Buffer.from([0, 1, 2, 3, 255, 254, 0, 42]);
    const a = makeAttachment(join(dir, "one.txt"), one);
    const b = makeAttachment(join(dir, "two.bin"), two);
    const withAtt = await runAddAttachments({ filePath: src, attachments: [a, b] }, okCtx, dir);

    const extracted = await runExtractAttachments({ filePath: withAtt }, okCtx, dir);
    expect(extracted.map((p) => basename(p)).sort()).toEqual(["one.txt", "two.bin"]);
    const byName = new Map(extracted.map((p) => [basename(p), p]));
    expect(readFileSync(byName.get("one.txt")!).equals(one)).toBe(true);
    expect(readFileSync(byName.get("two.bin")!).equals(two)).toBe(true);
  });

  it("reports UNSUPPORTED_FORMAT when the PDF has no embedded files", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "plain.pdf"), 1);
    await expect(
      runExtractAttachments({ filePath: src }, okCtx, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT });
  });

  it("sanitizes an embedded name with path separators into a safe file", async () => {
    const dir = outDir();
    const crafted = await PDFDocument.create();
    crafted.addPage();
    await crafted.attach(Buffer.from("traversal"), "evil/../name.txt");
    const src = join(dir, "crafted.pdf");
    writeFileSync(src, await crafted.save());

    const extracted = await runExtractAttachments({ filePath: src }, okCtx, dir);
    expect(extracted).toHaveLength(1);
    expect(basename(extracted[0])).toBe("name.txt");
    expect(extracted[0].startsWith(dir)).toBe(true);
    expect(existsSync(join(dir, "evil"))).toBe(false);
    expect(readFileSync(extracted[0]).toString()).toBe("traversal");
  });

  it("maps an encrypted source to ENCRYPTED_PDF", async () => {
    const dir = outDir();
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(runExtractAttachments({ filePath: enc }, okCtx, dir)).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.ENCRYPTED_PDF,
    });
  });

  it("throws CANCELLED when cancelled at entry", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "src.pdf"), 1);
    await expect(
      runExtractAttachments({ filePath: src }, { ...okCtx, cancelled: () => true }, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});

describe("runEditAttachments", () => {
  it("removes the named attachment and keeps the other", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "src.pdf"), 1);
    const a = makeAttachment(join(dir, "one.txt"), Buffer.from("aaa"));
    const b = makeAttachment(join(dir, "two.txt"), Buffer.from("bbbbb"));
    const withAtt = await runAddAttachments({ filePath: src, attachments: [a, b] }, okCtx, dir);

    const out = await runEditAttachments(
      { filePath: withAtt, removeNames: ["one.txt"] },
      okCtx,
      dir
    );
    expect(out).toBe(join(dir, "edited.pdf"));
    expect(await loadAttachmentNames(out)).toEqual(["two.txt"]);
  });

  it("is a no-op copy when removeNames is empty", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "src.pdf"), 1);
    const a = makeAttachment(join(dir, "one.txt"), Buffer.from("aaa"));
    const withAtt = await runAddAttachments({ filePath: src, attachments: [a] }, okCtx, dir);
    const out = await runEditAttachments({ filePath: withAtt, removeNames: [] }, okCtx, dir);
    expect(await loadAttachmentNames(out)).toEqual(["one.txt"]);
  });

  it("maps an encrypted source to ENCRYPTED_PDF", async () => {
    const dir = outDir();
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runEditAttachments({ filePath: enc, removeNames: ["x"] }, okCtx, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.ENCRYPTED_PDF });
  });

  it("throws CANCELLED when cancelled at entry", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "src.pdf"), 1);
    await expect(
      runEditAttachments({ filePath: src, removeNames: [] }, { ...okCtx, cancelled: () => true }, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});

describe("attachments.list RPC", () => {
  it("lists embedded files through a registered dispatcher method", async () => {
    const dir = outDir();
    const src = await makePdf(join(dir, "src.pdf"), 1);
    const a = makeAttachment(join(dir, "one.txt"), Buffer.from("aaa"));
    const b = makeAttachment(join(dir, "two.txt"), Buffer.from("bbbbb"));
    const withAtt = await runAddAttachments({ filePath: src, attachments: [a, b] }, okCtx, dir);

    const send = vi.fn();
    const dispatcher = createDispatcher(send);
    registerAttachmentsList(dispatcher);
    dispatcher.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "attachments.list",
        params: { filePath: withAtt },
      })
    );

    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          result: {
            attachments: [
              { name: "one.txt", size: 3 },
              { name: "two.txt", size: 5 },
            ],
          },
        })
      )
    );
  });
});

describe("attachments registry", () => {
  it("registers addAttachments, extractAttachments, and editAttachments", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("addAttachments")).toBe(true);
    expect(tools.has("extractAttachments")).toBe(true);
    expect(tools.has("editAttachments")).toBe(true);
  });
});
