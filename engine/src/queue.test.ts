import { describe, it, expect, vi } from "vitest";
import { JobQueue } from "./queue";

describe("JobQueue", () => {
  it("runs jobs serially in enqueue order", async () => {
    const order: number[] = [];
    const q = new JobQueue();
    q.enqueue({ jobId: "j1", run: async () => { await sleep(20); order.push(1); } });
    q.enqueue({ jobId: "j2", run: async () => { order.push(2); } });
    await q.idle();
    expect(order).toEqual([1, 2]);
  });

  it("cancel flag flips for active job", async () => {
    const q = new JobQueue();
    let sawCancelled = false;
    q.enqueue({
      jobId: "j1",
      run: async (ctx) => {
        await sleep(10);
        q.cancel("j1");
        await sleep(10);
        sawCancelled = ctx.cancelled();
      },
    });
    await q.idle();
    expect(sawCancelled).toBe(true);
  });

  it("failed job rejects and next job still runs", async () => {
    const onDone = vi.fn();
    const q = new JobQueue();
    q.enqueue({ jobId: "j1", run: async () => { throw new Error("boom"); }, onDone });
    q.enqueue({ jobId: "j2", run: async () => {}, onDone });
    await q.idle();
    expect(onDone).toHaveBeenCalledTimes(2);
    expect((onDone.mock.calls[0][0] as Error).message).toBe("boom");
  });
});

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
