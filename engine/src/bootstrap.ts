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
  PROGRESS_METHOD,
  TOOL_ERROR_CODES,
} from "@pogopdf/contracts";
import type {
  JobResult,
  JobStartParams,
  MultiFileResult,
} from "@pogopdf/contracts";
import { createDispatcher } from "./rpc/dispatcher";
import type { RpcCtx } from "./rpc/dispatcher";
import { JobQueue } from "./queue";
import { TempWorkspace } from "./temp";
import type { ToolRegistry } from "./tools/registry";

export const FileCopyParamsSchema = z.object({
  src: z.string().min(1),
  dest: z.string().min(1),
});

export function registerFileCopy(
  dispatcher: ReturnType<typeof createDispatcher>
): void {
  dispatcher.register("file.copy", (params) => {
    const p = FileCopyParamsSchema.parse(params);
    copyFileSync(p.src, p.dest);
    return { copied: true };
  }, FileCopyParamsSchema);
}

export function startEngine(options: {
  send: (msg: unknown) => void;
  tools: ToolRegistry;
}) {
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
    return new Promise<JobResult | MultiFileResult>((resolve, reject) => {
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
            const result = await tool.run(p.input, patched, outDir);
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
          // Multi-output tools (e.g. split) return string[]; everything else
          // returns a single path.
          if (Array.isArray(result)) {
            resolve(
              MultiFileResultSchema.parse({
                jobId: p.jobId,
                outputPaths: result,
              })
            );
          } else {
            resolve(
              JobResultSchema.parse({ jobId: p.jobId, outputPath: result })
            );
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

  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => dispatcher.handle(line));

  // watchdog: exit if stdin closes (parent died)
  process.stdin.on("end", () => process.exit(0));
  process.on("exit", () => temp.cleanupAll());

  return { dispatcher, queue, temp };
}
