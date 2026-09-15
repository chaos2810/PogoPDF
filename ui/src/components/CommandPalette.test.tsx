import { describe, it, expect } from "vitest";
import { t } from "@pogopdf/i18n";
import { registry } from "../tools/registry";

function matchTools(query: string, lang: "en" | "zh-TW") {
  return registry.filter((tool) =>
    t(tool.titleKey, lang).toLowerCase().includes(query.toLowerCase())
  );
}

describe("command palette matching", () => {
  it("finds merge by partial title", () => {
    expect(matchTools("mer", "en").map((m) => m.id)).toEqual(["merge"]);
  });
  it("finds merge in zh-TW", () => {
    expect(matchTools("合併", "zh-TW").map((m) => m.id)).toEqual(["merge"]);
  });
  it("empty query shows all", () => {
    expect(matchTools("", "en").length).toBe(registry.length);
  });
});
