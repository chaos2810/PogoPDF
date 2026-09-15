import { createInterface } from "node:readline";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JobStartParamsSchema,
  JobCancelParamsSchema,
  PROGRESS_METHOD,
} from "@pogopdf/contracts";
import { createDispatcher } from "./rpc/dispatcher";
import type { RpcCtx } from "./rpc/dispatcher";
import { JobQueue } from "./queue";
import { TempWorkspace } from "./temp";
import type { ToolRegistry } from "./tools/registry";

export function startEngine(options: {
  send: (msg: unknown) => void;
  tools: ToolRegistry;
}) {
  const { send, tools } = options;
  const dispatcher = createDispatcher(send);
  const queue = new JobQueue();
  const temp = new TempWorkspace(mkdtempSync(join(tmpdir(), "pogopdf-")));

  dispatcher.register("job.start", async (params) => {
    const p = JobStartParamsSchema.parse(params);
    const tool = tools.get(p.toolId);
    if (!tool) throw Object.assign(new Error("Unknown tool"), { code: -32601 });
    let outputPath: string | undefined;
    return new Promise<{ outputPath: string }>((resolve, reject) => {
      queue.enqueue({
        jobId: p.jobId,
        run: async (ctx) => {
          const patched: RpcCtx = {
            ...ctx,
            notifyProgress: (prog) =>
              send({ jsonrpc: "2.0", method: PROGRESS_METHOD, params: prog }),
          };
          const outDir = temp.dirFor(p.jobId);
          try {
            outputPath = await tool.run(p.input, patched, outDir);
            patched.notifyProgress({
              jobId: p.jobId,
              percent: 100,
              stage: "done",
              pagesDone: 0,
            });
          } catch (e) {
            temp.cleanup(p.jobId);
            throw e;
          }
        },
        onDone: (err) => (err ? reject(err) : resolve({ outputPath: outputPath! })),
      });
    });
  }, JobStartParamsSchema);

  dispatcher.register("job.cancel", (params) => {
    const p = JobCancelParamsSchema.parse(params);
    queue.cancel(p.jobId);
    temp.cleanup(p.jobId);
    return { cancelled: true };
  }, JobCancelParamsSchema);

  dispatcher.register("engine.ping", async () => ({ pong: true }));

  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => dispatcher.handle(line));

  // watchdog: exit if stdin closes (parent died)
  process.stdin.on("end", () => process.exit(0));
  process.on("exit", () => temp.cleanupAll());

  return { dispatcher, queue, temp };
}
