import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "rpc_call") {
      if (args.method === "fail") throw JSON.stringify({ code: -32000, message: "merge exploded" });
      return { outputPath: "C:\\tmp\\merged.pdf" };
    }
    if (cmd === "dialog_open_pdf") return ["C:\\a.pdf", "C:\\b.pdf"];
    if (cmd === "dialog_save") return "C:\\out\\merged.pdf";
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { startJob, pickPdfs, saveAsPdf, callEngine } from "./rpc";

describe("rpc wrappers", () => {
  it("startJob returns outputPath", async () => {
    const r = await startJob("merge", { filePaths: ["a", "b"] });
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
});
