import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { createDispatcher } from "./rpc/dispatcher";
import { registerFileCopy } from "./bootstrap";

function freshDispatcher() {
  const send = vi.fn();
  const dispatcher = createDispatcher(send);
  registerFileCopy(dispatcher);
  return { dispatcher, send };
}

describe("file.copy", () => {
  it("copies src to dest via the registered dispatcher method", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pogo-copy-"));
    const src = join(dir, "src.txt");
    const dest = join(dir, "dest.txt");
    writeFileSync(src, "hello");

    const { dispatcher, send } = freshDispatcher();
    dispatcher.handle(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "file.copy", params: { src, dest } })
    );

    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 1, result: { copied: true } }))
    );
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe("hello");
  });

  it("rejects invalid params with INVALID_INPUT", async () => {
    const { dispatcher, send } = freshDispatcher();
    dispatcher.handle(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "file.copy", params: { src: "", dest: "" } })
    );

    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 2,
          error: expect.objectContaining({ code: TOOL_ERROR_CODES.INVALID_INPUT }),
        })
      )
    );
  });
});
