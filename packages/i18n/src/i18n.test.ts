import { describe, it, expect } from "vitest";
import { t, keys, catalogs } from "./index";

describe("i18n", () => {
  it("translates a key in zh-TW", () => {
    expect(t("tool.merge.title", "zh-TW")).toBe("合併 PDF");
  });
  it("interpolates vars", () => {
    expect(t("status.running", "en", { name: "Merge", percent: "50" })).toBe("Merge · 50%");
  });
  it("falls back to key when missing", () => {
    expect(t("nope.missing", "en")).toBe("nope.missing");
  });
  it("zh-TW covers all en keys", () => {
    const enKeys = new Set(keys());
    const zhKeys = new Set(Object.keys(catalogs["zh-TW"]));
    for (const k of enKeys) expect(zhKeys.has(k)).toBe(true);
  });
});
