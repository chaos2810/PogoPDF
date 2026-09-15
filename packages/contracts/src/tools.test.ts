import { describe, it, expect } from "vitest";
import {
  MergeInputSchema, JobStartParamsSchema, ProgressParamsSchema, TOOL_IDS,
  SplitInputSchema, ExtractPagesInputSchema, DeletePagesInputSchema,
  OrganizeInputSchema, RotateInputSchema, RotateCustomInputSchema,
  ReverseInputSchema, AddBlankPageInputSchema, NupInputSchema,
  BookletInputSchema, DividePagesInputSchema, CombineSinglePageInputSchema,
  AlternateMixInputSchema, DuplexCollateInputSchema, MultiFileResultSchema,
} from "./tools";

const PDF = "C:\\a.pdf";

describe("MergeInputSchema", () => {
  it("accepts two paths", () => {
    expect(MergeInputSchema.safeParse({
      filePaths: ["C:\\a.pdf", "C:\\b.pdf"],
    }).success).toBe(true);
  });
  it("rejects one path", () => {
    expect(MergeInputSchema.safeParse({ filePaths: ["C:\\a.pdf"] }).success).toBe(false);
  });
});

describe("SplitInputSchema", () => {
  it("accepts ranges mode", () => {
    expect(SplitInputSchema.safeParse({ filePath: PDF, mode: "ranges", ranges: "1-3,5" }).success).toBe(true);
  });
  it("accepts every mode", () => {
    expect(SplitInputSchema.safeParse({ filePath: PDF, mode: "every", every: 2 }).success).toBe(true);
  });
  // mode="ranges" without ranges is NOT schema-rejected; required-ness is
  // conditional on mode, so the engine re-validates it.
  it("accepts ranges mode without ranges (engine re-validates)", () => {
    expect(SplitInputSchema.safeParse({ filePath: PDF, mode: "ranges" }).success).toBe(true);
  });
  it("rejects unknown mode", () => {
    expect(SplitInputSchema.safeParse({ filePath: PDF, mode: "chunks" }).success).toBe(false);
  });
});

describe("ExtractPagesInputSchema", () => {
  it("accepts filePath + pages", () => {
    expect(ExtractPagesInputSchema.safeParse({ filePath: PDF, pages: "1-3" }).success).toBe(true);
  });
  it("rejects missing pages", () => {
    expect(ExtractPagesInputSchema.safeParse({ filePath: PDF }).success).toBe(false);
  });
});

describe("DeletePagesInputSchema", () => {
  it("accepts filePath + pages", () => {
    expect(DeletePagesInputSchema.safeParse({ filePath: PDF, pages: "2" }).success).toBe(true);
  });
  it("rejects non-string pages", () => {
    expect(DeletePagesInputSchema.safeParse({ filePath: PDF, pages: 2 }).success).toBe(false);
  });
});

describe("OrganizeInputSchema", () => {
  it("accepts ordered page descriptors", () => {
    expect(OrganizeInputSchema.safeParse({
      pages: [{ srcIndex: 0 }, { srcIndex: 2, rotate: 90 }],
    }).success).toBe(true);
  });
  it("rejects an empty pages array", () => {
    expect(OrganizeInputSchema.safeParse({ pages: [] }).success).toBe(false);
  });
});

describe("RotateInputSchema", () => {
  it("accepts a valid angle", () => {
    expect(RotateInputSchema.safeParse({ filePath: PDF, angle: 180 }).success).toBe(true);
  });
  it("rejects an angle outside the enum", () => {
    expect(RotateInputSchema.safeParse({ filePath: PDF, angle: 45 }).success).toBe(false);
  });
});

describe("RotateCustomInputSchema", () => {
  it("accepts a non-zero float angle", () => {
    expect(RotateCustomInputSchema.safeParse({ filePath: PDF, angle: 12.5 }).success).toBe(true);
  });
  it("rejects 0", () => {
    expect(RotateCustomInputSchema.safeParse({ filePath: PDF, angle: 0 }).success).toBe(false);
  });
  it("rejects an angle beyond 360", () => {
    expect(RotateCustomInputSchema.safeParse({ filePath: PDF, angle: 361 }).success).toBe(false);
  });
});

describe("ReverseInputSchema", () => {
  it("accepts filePath", () => {
    expect(ReverseInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects an empty filePath", () => {
    expect(ReverseInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
});

describe("AddBlankPageInputSchema", () => {
  it("accepts position + a4 landscape", () => {
    expect(AddBlankPageInputSchema.safeParse({
      filePath: PDF, position: 3, size: "a4", orientation: "landscape",
    }).success).toBe(true);
  });
  it("rejects a negative position", () => {
    expect(AddBlankPageInputSchema.safeParse({
      filePath: PDF, position: -1, size: "match",
    }).success).toBe(false);
  });
});

describe("NupInputSchema", () => {
  it("accepts a supported layout with margin", () => {
    expect(NupInputSchema.safeParse({ filePath: PDF, layout: "2x2", margin: 6 }).success).toBe(true);
  });
  it("rejects an unsupported layout", () => {
    expect(NupInputSchema.safeParse({ filePath: PDF, layout: "5x5" }).success).toBe(false);
  });
});

describe("BookletInputSchema", () => {
  it("accepts filePath", () => {
    expect(BookletInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects an unknown key via .strict()", () => {
    expect(BookletInputSchema.safeParse({ filePath: PDF, paddedTo: 8 }).success).toBe(false);
  });
});

describe("DividePagesInputSchema", () => {
  it("accepts count within 2..10", () => {
    expect(DividePagesInputSchema.safeParse({
      filePath: PDF, direction: "horizontal", count: 3,
    }).success).toBe(true);
  });
  it("rejects count below 2", () => {
    expect(DividePagesInputSchema.safeParse({
      filePath: PDF, direction: "horizontal", count: 1,
    }).success).toBe(false);
  });
  it("rejects count above 10", () => {
    expect(DividePagesInputSchema.safeParse({
      filePath: PDF, direction: "horizontal", count: 11,
    }).success).toBe(false);
  });
});

describe("CombineSinglePageInputSchema", () => {
  it("accepts direction + align", () => {
    expect(CombineSinglePageInputSchema.safeParse({
      filePath: PDF, direction: "vertical", align: "center",
    }).success).toBe(true);
  });
  it("rejects an unknown align value", () => {
    expect(CombineSinglePageInputSchema.safeParse({
      filePath: PDF, direction: "vertical", align: "top",
    }).success).toBe(false);
  });
});

describe("AlternateMixInputSchema", () => {
  it("accepts exactly two paths", () => {
    expect(AlternateMixInputSchema.safeParse({
      filePaths: ["a.pdf", "b.pdf"], order: "alternate",
    }).success).toBe(true);
  });
  it("rejects one path", () => {
    expect(AlternateMixInputSchema.safeParse({ filePaths: ["a.pdf"], order: "alternate" }).success).toBe(false);
  });
  it("rejects three paths", () => {
    expect(AlternateMixInputSchema.safeParse({
      filePaths: ["a.pdf", "b.pdf", "c.pdf"], order: "inverse",
    }).success).toBe(false);
  });
});

describe("DuplexCollateInputSchema", () => {
  it("accepts filePath", () => {
    expect(DuplexCollateInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects the removed hasBackSheets option via .strict()", () => {
    expect(DuplexCollateInputSchema.safeParse({ filePath: PDF, hasBackSheets: true }).success).toBe(false);
  });
});

describe("JobStartParamsSchema", () => {
  it("accepts valid params", () => {
    expect(JobStartParamsSchema.safeParse({
      jobId: "123e4567-e89b-12d3-a456-426614174000",
      toolId: TOOL_IDS.merge,
      input: { filePaths: ["a.pdf", "b.pdf"] },
    }).success).toBe(true);
  });
  it("rejects non-uuid jobId", () => {
    expect(JobStartParamsSchema.safeParse({
      jobId: "nope", toolId: "merge", input: {},
    }).success).toBe(false);
  });
});

describe("ProgressParamsSchema", () => {
  it("rejects percent over 100", () => {
    expect(ProgressParamsSchema.safeParse({
      jobId: "123e4567-e89b-12d3-a456-426614174000",
      percent: 101, stage: "merging", pagesDone: 1,
    }).success).toBe(false);
  });
});

describe("MultiFileResultSchema", () => {
  it("accepts a jobId with output paths", () => {
    expect(MultiFileResultSchema.safeParse({
      jobId: "123e4567-e89b-12d3-a456-426614174000",
      outputPaths: ["C:\\out\\1.pdf", "C:\\out\\2.pdf"],
    }).success).toBe(true);
  });
  it("rejects an empty outputPaths array", () => {
    expect(MultiFileResultSchema.safeParse({
      jobId: "123e4567-e89b-12d3-a456-426614174000",
      outputPaths: [],
    }).success).toBe(false);
  });
});

describe("TOOL_IDS", () => {
  it("contains all 15 tools with values equal to their keys", () => {
    for (const [key, value] of Object.entries(TOOL_IDS)) {
      expect(value).toBe(key);
    }
    expect(Object.keys(TOOL_IDS)).toHaveLength(15);
  });
});
