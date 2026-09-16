import { z } from "zod";

export const TOOL_IDS = {
  merge: "merge",
  split: "split",
  extractPages: "extractPages",
  deletePages: "deletePages",
  organize: "organize",
  rotate: "rotate",
  rotateCustom: "rotateCustom",
  reverse: "reverse",
  addBlankPage: "addBlankPage",
  nup: "nup",
  booklet: "booklet",
  dividePages: "dividePages",
  combineSinglePage: "combineSinglePage",
  alternateMix: "alternateMix",
  duplexCollate: "duplexCollate",
} as const;

export const MergeInputSchema = z.object({
  filePaths: z.array(z.string().min(1)).min(2).max(100),
});
export type MergeInput = z.infer<typeof MergeInputSchema>;

export const SplitInputSchema = z
  .object({
    filePath: z.string().min(1),
    mode: z.enum(["ranges", "every", "single"]),
    // Required when mode="ranges"; engine re-validates conditionally.
    ranges: z.string().optional(),
    // Required when mode="every"; int >= 1.
    every: z.number().int().min(1).optional(),
    // A bare file-name stem: path separators would let it escape the output
    // dir. Empty is allowed and falls back to the source basename.
    filePrefix: z
      .string()
      .regex(/^[^\\/]*$/, "filePrefix must not contain path separators")
      .optional(),
  })
  .strict();
export type SplitInput = z.infer<typeof SplitInputSchema>;

export const ExtractPagesInputSchema = z
  .object({
    filePath: z.string().min(1),
    pages: z.string(),
  })
  .strict();
export type ExtractPagesInput = z.infer<typeof ExtractPagesInputSchema>;

export const DeletePagesInputSchema = z
  .object({
    filePath: z.string().min(1),
    pages: z.string(),
  })
  .strict();
export type DeletePagesInput = z.infer<typeof DeletePagesInputSchema>;

export const OrganizeInputSchema = z
  .object({
    filePath: z.string().min(1),
    pages: z
      .array(
        z
          .object({
            srcIndex: z.number().int().nonnegative(),
            rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type OrganizeInput = z.infer<typeof OrganizeInputSchema>;

export const RotateInputSchema = z
  .object({
    filePath: z.string().min(1),
    angle: z.union([z.literal(90), z.literal(180), z.literal(270)]),
    // Defaults to all pages when omitted.
    pages: z.string().optional(),
  })
  .strict();
export type RotateInput = z.infer<typeof RotateInputSchema>;

export const RotateCustomInputSchema = z
  .object({
    filePath: z.string().min(1),
    angle: z
      .number()
      .min(-360)
      .max(360)
      .refine((a) => a !== 0, { message: "angle must not be 0" }),
  })
  .strict();
export type RotateCustomInput = z.infer<typeof RotateCustomInputSchema>;

export const ReverseInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type ReverseInput = z.infer<typeof ReverseInputSchema>;

export const AddBlankPageInputSchema = z
  .object({
    filePath: z.string().min(1),
    // 0-based insert index; upper bound (pageCount) is not schema-checkable.
    position: z.number().int().nonnegative(),
    size: z.enum(["match", "a4"]),
    // Only meaningful with size="a4".
    orientation: z.enum(["portrait", "landscape"]).optional(),
  })
  .strict();
export type AddBlankPageInput = z.infer<typeof AddBlankPageInputSchema>;

export const NupInputSchema = z
  .object({
    filePath: z.string().min(1),
    layout: z.enum(["2x1", "1x2", "2x2", "3x3", "4x4"]),
    // Points, 0..72; engine default is 6.
    margin: z.number().min(0).max(72).optional(),
  })
  .strict();
export type NupInput = z.infer<typeof NupInputSchema>;

export const BookletInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type BookletInput = z.infer<typeof BookletInputSchema>;

export const DividePagesInputSchema = z
  .object({
    filePath: z.string().min(1),
    direction: z.enum(["horizontal", "vertical"]),
    count: z.number().int().min(2).max(10),
  })
  .strict();
export type DividePagesInput = z.infer<typeof DividePagesInputSchema>;

export const CombineSinglePageInputSchema = z
  .object({
    filePath: z.string().min(1),
    direction: z.enum(["vertical", "horizontal"]),
    align: z.enum(["start", "center", "end"]),
  })
  .strict();
export type CombineSinglePageInput = z.infer<typeof CombineSinglePageInputSchema>;

export const AlternateMixInputSchema = z
  .object({
    filePaths: z.array(z.string().min(1)).length(2),
    order: z.enum(["alternate", "inverse"]),
  })
  .strict();
export type AlternateMixInput = z.infer<typeof AlternateMixInputSchema>;

/**
 * Collates a duplex scan: the scanned document is a stack of fronts followed
 * by the same stack of backs in reverse order. pageCount must be even;
 * fronts = pages 1..N/2, backs = N/2+1..N reversed, output = F1,B1,F2,B2, …
 * where B1 is the last scanned page.
 */
export const DuplexCollateInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type DuplexCollateInput = z.infer<typeof DuplexCollateInputSchema>;

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

export const MultiFileResultSchema = z.object({
  jobId: z.string().uuid(),
  outputPaths: z.array(z.string()).min(1),
});
export type MultiFileResult = z.infer<typeof MultiFileResultSchema>;
