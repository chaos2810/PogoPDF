import { describe, it, expect } from "vitest";
import { shapeJobResult } from "./bootstrap";

const JOB = "123e4567-e89b-12d3-a456-426614174000";

describe("shapeJobResult", () => {
  it("wraps a string as a single-file result", () => {
    expect(shapeJobResult(JOB, "C:\\out.pdf")).toEqual({
      jobId: JOB,
      outputPath: "C:\\out.pdf",
    });
  });

  it("wraps a string array as a multi-file result", () => {
    expect(shapeJobResult(JOB, ["a.pdf", "b.pdf"])).toEqual({
      jobId: JOB,
      outputPaths: ["a.pdf", "b.pdf"],
    });
  });

  it("wraps a plain object as a data result", () => {
    expect(shapeJobResult(JOB, { pageCount: 2 })).toEqual({
      jobId: JOB,
      data: { pageCount: 2 },
    });
  });

  it("throws an internal error for undefined (not a data result)", () => {
    expect(() => shapeJobResult(JOB, undefined)).toThrowError(
      expect.objectContaining({ code: -32000, message: "Tool returned no result" })
    );
  });

  it("rejects an empty outputPaths array via the schema", () => {
    expect(() => shapeJobResult(JOB, [])).toThrow();
  });
});
