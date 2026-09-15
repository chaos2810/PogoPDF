import { describe, it, expect } from "vitest";
import { basename } from "./paths";

describe("basename", () => {
  it("extracts the file name from a Windows path", () => {
    expect(basename("C:\\Users\\demo\\Documents\\report.pdf")).toBe("report.pdf");
  });

  it("extracts the file name from a forward-slash path", () => {
    expect(basename("/home/demo/report.pdf")).toBe("report.pdf");
  });

  it("handles a mixed-separator path", () => {
    expect(basename("C:\\Users\\demo/Notes\\final.pdf")).toBe("final.pdf");
  });

  it("returns the input when there is no separator", () => {
    expect(basename("report.pdf")).toBe("report.pdf");
  });

  it("keeps a long CJK file name intact", () => {
    const name = "研究計画書".repeat(4) + ".pdf";
    expect(basename("C:\\docs\\" + name)).toBe(name);
  });
});
