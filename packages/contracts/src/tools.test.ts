import { describe, it, expect } from "vitest";
import {
  MergeInputSchema, JobStartParamsSchema, ProgressParamsSchema, TOOL_IDS,
} from "./tools";

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
