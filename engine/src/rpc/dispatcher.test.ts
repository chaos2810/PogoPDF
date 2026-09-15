import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createDispatcher } from "./dispatcher";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";

describe("createDispatcher", () => {
  it("routes requests to registered methods and returns result", async () => {
    const send = vi.fn();
    const d = createDispatcher(send);
    d.register("ping", async () => "pong");
    d.handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, result: "pong" })
      )
    );
  });

  it("returns typed error for unregistered method", async () => {
    const send = vi.fn();
    const d = createDispatcher(send);
    d.handle(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "nope" }));
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 2,
          error: expect.objectContaining({ code: -32601 }),
        })
      )
    );
  });

  it("returns INVALID_INPUT when params fail schema", async () => {
    const send = vi.fn();
    const d = createDispatcher(send);
    d.register("needs.num", async (params) => params, z.object({ n: z.number() }));
    d.handle(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "needs.num", params: { n: "NaN" } }));
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 3,
          error: expect.objectContaining({ code: TOOL_ERROR_CODES.INVALID_INPUT }),
        })
      )
    );
  });
});
