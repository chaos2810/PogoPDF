import { createInterface } from "node:readline";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  JobResultSchema,
  JobStartParamsSchema,
  JobCancelParamsSchema,
  MultiFileResultSchema,
  DataResultSchema,
  PROGRESS_METHOD,
  TOOL_ERROR_CODES,
} from "@pogopdf/contracts";
import type {
  JobResult,
  JobStartParams,
  MultiFileResult,
  DataResult,
} from "@pogopdf/contracts";
import { createDispatcher } from "./rpc/dispatcher";
import type { RpcCtx } from "./rpc/dispatcher";
import { JobQueue } from "./queue";
import { TempWorkspace } from "./temp";
import type { ToolRegistry } from "./tools/registry";
import { loadPdf } from "./tools/pdfdoc";
import { listEmbeddedFiles } from "./tools/richcontent/embeddedfiles";

export const FileCopyParamsSchema = z.object({
  src: z.string().min(1),
  dest: z.string().min(1),
});

export const AttachmentsListParamsSchema = z.object({
  filePath: z.string().min(1),
});

/**
 * Wrap a tool's raw return value in the right result envelope. Multi-output
 * tools (e.g. split) return string[]; data tools (e.g. viewMetadata) return a
 * plain object; everything else returns a single path. `undefined` is a tool
 * bug, not an empty data result: reject it so it surfaces as an RPC error
 * instead of silently resolving as `{data: undefined}`.
 */
export function shapeJobResult(
  jobId: string,
  result: unknown
): JobResult | MultiFileResult | DataResult {
  if (result === undefined) {
    throw Object.assign(new Error("Tool returned no result"), { code: -32000 });
  }
  if (Array.isArray(result)) {
    return MultiFileResultSchema.parse({ jobId, outputPaths: result });
  }
  if (typeof result === "string") {
    return JobResultSchema.parse({ jobId, outputPath: result });
  }
  return DataResultSchema.parse({ jobId, data: result });
}

export function registerFileCopy(
  dispatcher: ReturnType<typeof createDispatcher>
): void {
  dispatcher.register("file.copy", (params) => {
    const p = FileCopyParamsSchema.parse(params);
    copyFileSync(p.src, p.dest);
    return { copied: true };
  }, FileCopyParamsSchema);
}

/**
 * The attachments editor lists embedded files before running the edit tool.
 * This is an RPC method (like file.copy), not a tool: it returns its data
 * directly rather than through the job queue.
 */
export function registerAttachmentsList(
  dispatcher: ReturnType<typeof createDispatcher>
): void {
  dispatcher.register(
    "attachments.list",
    async (params) => {
      const p = AttachmentsListParamsSchema.parse(params);
      const doc = await loadPdf(p.filePath, { updateMetadata: false });
      return { attachments: listEmbeddedFiles(doc) };
    },
    AttachmentsListParamsSchema
  );
}

// pdfjs-dist 6 uses Promise.withResolvers (Node 22+); fail loudly before that.
function assertNodeVersion(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    process.stderr.write(
      `PogoPDF engine requires Node >= 22.13.0 (found ${process.versions.node})\n`
    );
    process.exit(1);
  }
}

export function startEngine(options: {
  send: (msg: unknown) => void;
  tools: ToolRegistry;
}) {
  assertNodeVersion();
  const { send, tools } = options;
  const dispatcher = createDispatcher(send);
  const queue = new JobQueue();
  const temp = new TempWorkspace(mkdtempSync(join(tmpdir(), "pogopdf-")));

  dispatcher.register("job.start", async (params) => {
    // Params are already validated by the dispatcher (registered with schema).
    const p = params as JobStartParams;
    const tool = tools.get(p.toolId);
    if (!tool) {
      throw Object.assign(new Error("Unknown tool"), {
        code: TOOL_ERROR_CODES.INVALID_INPUT,
      });
    }
    // Single validation point: enforce the per-tool schema here so every entry
    // in ToolRegistry.schema is live. Handlers still call their own .parse()
    // for type-safe destructuring, which is redundant but harmless (same schema,
    // idempotent). This guarantees invalid input never reaches tool.run.
    const parsed = tool.schema.safeParse(p.input);
    if (!parsed.success) {
      throw Object.assign(new Error("Invalid input"), {
        code: TOOL_ERROR_CODES.INVALID_INPUT,
      });
    }
    const input = parsed.data;
    return new Promise<JobResult | MultiFileResult | DataResult>((resolve, reject) => {
      queue.enqueue({
        jobId: p.jobId,
        run: async (ctx) => {
          const patched: RpcCtx = {
            ...ctx,
            notifyProgress: (prog) =>
              send({
                jsonrpc: "2.0",
                method: PROGRESS_METHOD,
                params: { ...(prog as object), jobId: p.jobId },
              }),
          };
          const outDir = temp.dirFor(p.jobId);
          try {
            const result = await tool.run(input, patched, outDir);
            patched.notifyProgress({
              jobId: p.jobId,
              percent: 100,
              stage: "done",
              pagesDone: 0,
            });
            return result;
          } catch (e) {
            // Covers tool failures and CANCELLED throws (the cancel RPC only
            // signals; the running tool observes ctx.cancelled() and throws).
            temp.cleanup(p.jobId);
            throw e;
          }
        },
        onDone: (err, result) => {
          if (err) {
            reject(err);
            return;
          }
          try {
            resolve(shapeJobResult(p.jobId, result));
          } catch (e) {
            reject(e);
          }
        },
      });
    });
  }, JobStartParamsSchema);

  // Cancellation only signals the queue. The running tool throws CANCELLED,
  // and the run wrapper above cleans the temp dir. Deleting the dir here would
  // race a live job (Windows EBUSY/EPERM on open handles, ENOENT for tools
  // writing incrementally).
  // Successful job dirs are intentionally left in place so the UI can Save As;
  // the OS temp dir reclaims them, and cleanupAll() runs on engine exit.
  dispatcher.register("job.cancel", (params) => {
    const p = JobCancelParamsSchema.parse(params);
    queue.cancel(p.jobId);
    return { cancelled: true };
  }, JobCancelParamsSchema);

  dispatcher.register("engine.ping", async () => ({ pong: true }));

  registerFileCopy(dispatcher);
  registerAttachmentsList(dispatcher);

  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => dispatcher.handle(line));

  // watchdog: exit if stdin closes (parent died)
  process.stdin.on("end", () => process.exit(0));
  process.on("exit", () => temp.cleanupAll());

  return { dispatcher, queue, temp };
}
