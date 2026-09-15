import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "rpc_call") {
      if (args.method === "fail") throw JSON.stringify({ code: -32000, message: "merge exploded" });
      return { jobId: "123e4567-e89b-12d3-a456-426614174000", outputPath: "C:\\tmp\\merged.pdf" };
    }
    if (cmd === "dialog_open_pdf") return ["C:\\a.pdf", "C:\\b.pdf"];
    if (cmd === "dialog_save") return "C:\\out\\merged.pdf";
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { startJob, pickPdfs, saveAsPdf, callEngine, onProgress } from "./rpc";
import { listen } from "@tauri-apps/api/event";

describe("rpc wrappers", () => {
  it("startJob returns validated jobId and outputPath", async () => {
    const r = await startJob("merge", { filePaths: ["a", "b"] });
    expect(r.jobId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(r.outputPath).toBe("C:\\tmp\\merged.pdf");
  });

  it("pickPdfs returns list", async () => {
    expect(await pickPdfs(true)).toHaveLength(2);
  });

  it("saveAsPdf returns path", async () => {
    expect(await saveAsPdf("merged.pdf")).toBe("C:\\out\\merged.pdf");
  });

  it("callEngine rejects with parsed engine error code and message", async () => {
    await expect(callEngine("fail")).rejects.toMatchObject({
      message: "merge exploded",
      code: -32000,
    });
  });

  it("onProgress unwraps JSON-RPC notification params", async () => {
    type Handler = (e: { payload: unknown }) => void;
    let handler: Handler | undefined;
    vi.mocked(listen).mockImplementationOnce(
      (async (_event: string, cb: Handler) => {
        handler = cb;
        return () => {};
      }) as unknown as typeof listen
    );
    const received: unknown[] = [];
    onProgress((p) => received.push(p));

    handler!({
      payload: {
        jsonrpc: "2.0",
        method: "progress",
        params: { jobId: "j1", percent: 42, stage: "merging", pagesDone: 1 },
      },
    });

    expect(received).toEqual([{ jobId: "j1", percent: 42, stage: "merging", pagesDone: 1 }]);
    expect((received[0] as { percent?: number }).percent).toBe(42);
  });
});
