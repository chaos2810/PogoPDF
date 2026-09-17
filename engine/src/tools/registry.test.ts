import { describe, it, expect } from "vitest";
import { TOOL_IDS } from "@pogopdf/contracts";
import { registerTools } from "./registry";
import type { ToolRegistry } from "./registry";

/**
 * The whole point of this suite: a tool id that exists in contracts and has a UI
 * screen but no engine module would only fail at runtime ("Unknown tool"). This
 * exact-equality check catches that at test time.
 */
describe("engine tool registry coverage", () => {
  let tools: ToolRegistry;

  it("registers every TOOL_IDS value", () => {
    tools = new Map();
    registerTools(tools);
    const missing = Object.values(TOOL_IDS).filter((id) => !tools.has(id));
    expect(missing).toEqual([]);
  });

  it("registers no ids outside TOOL_IDS", () => {
    tools = new Map();
    registerTools(tools);
    const known = new Set<string>(Object.values(TOOL_IDS));
    const extra = [...tools.keys()].filter((id) => !known.has(id));
    expect(extra).toEqual([]);
  });

  it("gives every entry a schema and a run function", () => {
    tools = new Map();
    registerTools(tools);
    for (const [id, entry] of tools) {
      expect(typeof entry.run, id).toBe("function");
      expect(typeof entry.schema?.safeParse, id).toBe("function");
    }
  });
});
