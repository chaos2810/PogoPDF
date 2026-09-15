import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { RpcCtx } from "./rpc/dispatcher";

type Job = {
  jobId: string;
  run: (ctx: RpcCtx) => Promise<void>;
  onDone?: (err: unknown) => void;
};

export class JobQueue {
  private jobs: Job[] = [];
  private running = false;
  private cancelledIds = new Set<string>();
  private idleResolvers: (() => void)[] = [];

  enqueue(job: Job) {
    this.jobs.push(job);
    void this.drain();
  }

  cancel(jobId: string) {
    this.cancelledIds.add(jobId);
    const queued = this.jobs.filter((j) => j.jobId === jobId);
    this.jobs = this.jobs.filter((j) => j.jobId !== jobId);
    for (const j of queued) {
      j.onDone?.(
        Object.assign(new Error(`Job ${jobId} cancelled while queued`), {
          code: TOOL_ERROR_CODES.CANCELLED,
        })
      );
      this.cancelledIds.delete(jobId);
    }
  }

  isCancelled(jobId: string): boolean {
    return this.cancelledIds.has(jobId);
  }

  async idle(): Promise<void> {
    if (!this.running && this.jobs.length === 0) return;
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      const ctx: RpcCtx = {
        cancelled: () => this.cancelledIds.has(job.jobId),
        notifyProgress: () => {}, // engine patches this per-job
      };
      try {
        await job.run(ctx);
        job.onDone?.(undefined);
      } catch (e) {
        job.onDone?.(e);
      } finally {
        this.cancelledIds.delete(job.jobId);
      }
    }
    this.running = false;
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    resolvers.forEach((r) => r());
  }
}
