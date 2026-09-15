import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";

const ENGINE_DIR = join(import.meta.dirname, "..");

async function makePdf(path: string, pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]);
  writeFileSync(path, await doc.save());
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
});
