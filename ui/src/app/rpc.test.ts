import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "rpc_call") {
      if (args.method === "fail") throw JSON.stringify({ code: -32000, message: "merge exploded" });
      if (args.method === "job.start") {
        const toolId = (args.params as { toolId?: string }).toolId;
        if (toolId === "cancelled") {
          throw JSON.stringify({ code: -32005, message: "Job cancelled" });
        }
        if (toolId === "split") {
          return {
            jobId: "123e4567-e89b-12d3-a456-426614174000",
            outputPaths: ["C:\\tmp\\1.pdf", "C:\\tmp\\2.pdf", "C:\\tmp\\3.pdf"],
          };
        }
      }
      return { jobId: "123e4567-e89b-12d3-a456-426614174000", outputPath: "C:\\tmp\\merged.pdf" };
    }
    if (cmd === "dialog_open_pdf") return ["C:\\a.pdf", "C:\\b.pdf"];
    if (cmd === "dialog_save") return "C:\\out\\merged.pdf";
    if (cmd === "dialog_pick_folder") return "C:\\Users\\demo\\Downloads\\split-out";
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { startJob, pickPdfs, saveAsPdf, callEngine, onProgress, pickFolder, cancelJob } from "./rpc";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";

describe("rpc wrappers", () => {
  it("startJob returns validated jobId and outputPath", async () => {
    const r = await startJob("merge", { filePaths: ["a", "b"] });
    expect(r.jobId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect("outputPath" in r && r.outputPath).toBe("C:\\tmp\\merged.pdf");
  });

  it("startJob surfaces the generated jobId before resolving", async () => {
    vi.mocked(invoke).mockClear();
    let seen: string | null = null;
    await startJob("merge", { filePaths: ["a", "b"] }, { onJobId: (id) => { seen = id; } });
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    // The id handed to the caller is the one sent to the engine.
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("rpc_call", {
      method: "job.start",
      params: expect.objectContaining({ jobId: seen }),
    });
  });

  it("startJob surfaces a cancelled job as code -32005 (the pick-phase branch)", async () => {
    await expect(startJob("cancelled", {})).rejects.toMatchObject({
      message: "Job cancelled",
      code: TOOL_ERROR_CODES.CANCELLED,
    });
  });

  it("cancelJob issues a job.cancel rpc", async () => {
    vi.mocked(invoke).mockClear();
    await cancelJob("123e4567-e89b-12d3-a456-426614174000");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("rpc_call", {
      method: "job.cancel",
      params: { jobId: "123e4567-e89b-12d3-a456-426614174000" },
    });
  });

  it("startJob parses a multi-file result into outputPaths", async () => {
    const r = await startJob("split", { filePath: "a.pdf", mode: "single" });
    expect("outputPaths" in r && r.outputPaths).toEqual([
      "C:\\tmp\\1.pdf",
      "C:\\tmp\\2.pdf",
      "C:\\tmp\\3.pdf",
    ]);
  });

  it("pickFolder returns the chosen folder", async () => {
    expect(await pickFolder()).toBe("C:\\Users\\demo\\Downloads\\split-out");
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
