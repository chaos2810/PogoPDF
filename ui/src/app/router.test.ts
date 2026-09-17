import { describe, it, expect } from "vitest";
import { registry } from "../tools/registry";
import { TOOL_SCREENS } from "./router";

describe("tool screens", () => {
  it("every registry tool has a screen", () => {
    const missing = registry
      .filter((tool) => !(tool.id in TOOL_SCREENS))
      .map((tool) => tool.id);
    expect(missing).toEqual([]);
  });
});
