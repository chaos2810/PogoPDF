import { z } from "zod";

export const TOOL_IDS = {
  merge: "merge",
} as const;

export const MergeInputSchema = z.object({
  filePaths: z.array(z.string().min(1)).min(2).max(100),
});
export type MergeInput = z.infer<typeof MergeInputSchema>;

export const JobStartParamsSchema = z.object({
  jobId: z.string().uuid(),
  toolId: z.string(),
  input: z.unknown(),
});
export type JobStartParams = z.infer<typeof JobStartParamsSchema>;

export const JobCancelParamsSchema = z.object({
  jobId: z.string().uuid(),
});
export type JobCancelParams = z.infer<typeof JobCancelParamsSchema>;

export const ProgressParamsSchema = z.object({
  jobId: z.string().uuid(),
  percent: z.number().min(0).max(100),
  stage: z.string(),
  pagesDone: z.number().int().nonnegative(),
});
export type ProgressParams = z.infer<typeof ProgressParamsSchema>;

export const JobResultSchema = z.object({
  jobId: z.string().uuid(),
  outputPath: z.string(),
});
export type JobResult = z.infer<typeof JobResultSchema>;
