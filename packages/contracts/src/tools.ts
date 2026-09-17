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
  pdfToImages: "pdfToImages",
  pdfToText: "pdfToText",
  pdfToSvg: "pdfToSvg",
  pdfToCbz: "pdfToCbz",
  pdfToGreyscale: "pdfToGreyscale",
  extractImages: "extractImages",
  viewMetadata: "viewMetadata",
  pageDimensions: "pageDimensions",
  fixPageSize: "fixPageSize",
  imagesToPdf: "imagesToPdf",
  textToPdf: "textToPdf",
  markdownToPdf: "markdownToPdf",
  csvToPdf: "csvToPdf",
  pageNumbers: "pageNumbers",
  watermark: "watermark",
  crop: "crop",
  headerFooter: "headerFooter",
  editMetadata: "editMetadata",
  protect: "protect",
  unlock: "unlock",
  flatten: "flatten",
  removeMetadata: "removeMetadata",
  comparePdfs: "comparePdfs",
  pdfsToZip: "pdfsToZip",
  rasterize: "rasterize",
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

/**
 * ONE tool covers all five raster formats (not five near-duplicate tools): the
 * home grid shows a single "PDF to Images" entry with a format picker.
 * quality is meaningful only for lossy jpg/webp; the engine defaults it to 80.
 * It stays absent here for png/bmp/tiff (a plain .default(80) would make it
 * present for every format and defeat the superRefine below).
 */
export const PdfToImagesInputSchema = z
  .object({
    filePath: z.string().min(1),
    format: z.enum(["jpg", "png", "webp", "bmp", "tiff"]),
    dpi: z.number().int().min(72).max(600).default(150),
    // Page selection; defaults to all pages when omitted.
    pages: z.string().optional(),
    quality: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.quality !== undefined && v.format !== "jpg" && v.format !== "webp") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quality"],
        message: "quality is only supported for jpg and webp",
      });
    }
  });
export type PdfToImagesInput = z.infer<typeof PdfToImagesInputSchema>;

/** Single .txt output: pages joined with form feeds. */
export const PdfToTextInputSchema = z
  .object({
    filePath: z.string().min(1),
    pages: z.string().optional(),
  })
  .strict();
export type PdfToTextInput = z.infer<typeof PdfToTextInputSchema>;

export const PdfToSvgInputSchema = z
  .object({
    filePath: z.string().min(1),
    dpi: z.number().int().min(72).max(600).default(150),
    pages: z.string().optional(),
  })
  .strict();
export type PdfToSvgInput = z.infer<typeof PdfToSvgInputSchema>;

/** One .cbz (zip) output containing page-NNN.png entries. */
export const PdfToCbzInputSchema = z
  .object({
    filePath: z.string().min(1),
    dpi: z.number().int().min(72).max(600).default(150),
  })
  .strict();
export type PdfToCbzInput = z.infer<typeof PdfToCbzInputSchema>;

/** Single PDF output: pages rasterized, desaturated, re-embedded. */
export const PdfToGreyscaleInputSchema = z
  .object({
    filePath: z.string().min(1),
    pages: z.string().optional(),
  })
  .strict();
export type PdfToGreyscaleInput = z.infer<typeof PdfToGreyscaleInputSchema>;

/** Multi-output: every embedded image extracted as image-{n}.{ext}. */
export const ExtractImagesInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type ExtractImagesInput = z.infer<typeof ExtractImagesInputSchema>;

/** Data result (no output file): structured metadata via DataResultSchema. */
export const ViewMetadataInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type ViewMetadataInput = z.infer<typeof ViewMetadataInputSchema>;

/** Data result: per-page width/height in pt + mm plus orientation. */
export const PageDimensionsInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type PageDimensionsInput = z.infer<typeof PageDimensionsInputSchema>;

/**
 * fit="scale" scales content to fit the target box preserving aspect;
 * fit="pad" centers content without upscaling (downscales only if it overflows).
 */
export const FixPageSizeInputSchema = z
  .object({
    filePath: z.string().min(1),
    size: z.enum(["a4", "letter", "a3", "a5"]),
    orientation: z.enum(["portrait", "landscape"]),
    fit: z.enum(["scale", "pad"]),
  })
  .strict();
export type FixPageSizeInput = z.infer<typeof FixPageSizeInputSchema>;

/**
 * fit = each page is sized to its own image; a4/letter impose one page size for
 * all images, so orientation is only meaningful (and only allowed) there.
 */
export const ImagesToPdfInputSchema = z
  .object({
    filePaths: z.array(z.string().min(1)).min(1).max(100),
    pageSize: z.enum(["fit", "a4", "letter"]).default("fit"),
    orientation: z.enum(["portrait", "landscape"]).optional(),
    margin: z.number().min(0).max(72).default(0),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.pageSize === "fit" && v.orientation !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orientation"],
        message: "orientation is only supported with a4 or letter pageSize",
      });
    }
  });
export type ImagesToPdfInput = z.infer<typeof ImagesToPdfInputSchema>;

/** Single .txt output "basename.pdf". */
export const TextToPdfInputSchema = z
  .object({
    filePath: z.string().min(1),
    fontSize: z.number().int().min(6).max(72).default(12),
    margins: z.number().min(0).max(144).default(72),
  })
  .strict();
export type TextToPdfInput = z.infer<typeof TextToPdfInputSchema>;

/** Single .md output "basename.pdf"; marked renders the markdown body. */
export const MarkdownToPdfInputSchema = z
  .object({
    filePath: z.string().min(1),
    fontSize: z.number().int().min(6).max(72).default(12),
    margins: z.number().min(0).max(144).default(72),
  })
  .strict();
export type MarkdownToPdfInput = z.infer<typeof MarkdownToPdfInputSchema>;

/** Single .csv output "basename.pdf": the rows become one table. */
export const CsvToPdfInputSchema = z
  .object({
    filePath: z.string().min(1),
    fontSize: z.number().int().min(6).max(72).default(10),
    orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  })
  .strict();
export type CsvToPdfInput = z.infer<typeof CsvToPdfInputSchema>;

/** v1 formats render as "1", "1 / 5" and "Page 1". */
export const PageNumbersInputSchema = z
  .object({
    filePath: z.string().min(1),
    position: z.enum([
      "bottom-center",
      "bottom-right",
      "bottom-left",
      "top-center",
      "top-right",
      "top-left",
    ]),
    format: z.enum(["n", "n-of-total", "page-n"]),
    startNumber: z.number().int().default(1),
    fontSize: z.number().int().min(6).max(72).default(10),
    margin: z.number().min(0).max(144).default(28),
    pages: z.string().optional(),
    skipFirst: z.boolean().default(false),
  })
  .strict();
export type PageNumbersInput = z.infer<typeof PageNumbersInputSchema>;

/** Text or image watermark; exactly one source must be given. */
export const WatermarkInputSchema = z
  .object({
    filePath: z.string().min(1),
    text: z.string().optional(),
    imagePath: z.string().min(1).optional(),
    opacity: z.number().min(0.05).max(1).default(0.15),
    // A watermark is a display element, not body copy: allow it to span a page.
    fontSize: z.number().int().min(6).max(200).default(48),
    rotation: z.number().min(-360).max(360).default(45),
    // Defaulted after validation (not via .default) so the superRefine below can
    // tell an explicit color from the absent one; color is text-only.
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be a #RRGGBB hex string").optional(),
    pages: z.string().optional(),
    position: z.enum(["center", "tile"]).default("center"),
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasText = v.text !== undefined;
    const hasImage = v.imagePath !== undefined;
    if (hasText === hasImage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "provide exactly one of text or imagePath",
      });
      return;
    }
    // Image mode v1 always centers a single stamp and has no color.
    if (hasImage) {
      if (v.position !== "center") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["position"],
          message: "position tile is only supported for text watermarks",
        });
      }
      if (v.color !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["color"],
          message: "color is only supported for text watermarks",
        });
      }
    }
  })
  .transform((v) => ({ ...v, color: v.color ?? "#808080" }));
export type WatermarkInput = z.infer<typeof WatermarkInputSchema>;

/**
 * Crop insets the MediaBox/CropBox; the resulting box must stay >= 10pt, which
 * the engine checks against the actual page size. All-zero is rejected here
 * because it would be a silent no-op.
 */
export const CropInputSchema = z
  .object({
    filePath: z.string().min(1),
    top: z.number().min(0).max(500).default(0),
    bottom: z.number().min(0).max(500).default(0),
    left: z.number().min(0).max(500).default(0),
    right: z.number().min(0).max(500).default(0),
    pages: z.string().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.top === 0 && v.bottom === 0 && v.left === 0 && v.right === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["top"],
        message: "at least one crop inset must be non-zero",
      });
    }
  });
export type CropInput = z.infer<typeof CropInputSchema>;

/** At least one of header/footer must be non-empty after trimming. */
export const HeaderFooterInputSchema = z
  .object({
    filePath: z.string().min(1),
    header: z.string().optional(),
    footer: z.string().optional(),
    fontSize: z.number().int().min(6).max(72).default(10),
    margin: z.number().min(0).max(144).default(28),
    pages: z.string().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.header?.trim() && !v.footer?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["header"],
        message: "provide a non-empty header or footer",
      });
    }
  });
export type HeaderFooterInput = z.infer<typeof HeaderFooterInputSchema>;

/**
 * null removes the field, undefined (absent) leaves it unchanged; the engine
 * edits the info dict only (v1 has no date editing).
 */
export const EditMetadataInputSchema = z
  .object({
    filePath: z.string().min(1),
    title: z.string().nullable().optional(),
    author: z.string().nullable().optional(),
    subject: z.string().nullable().optional(),
    keywords: z.string().nullable().optional(),
    creator: z.string().nullable().optional(),
    producer: z.string().nullable().optional(),
  })
  .strict();
export type EditMetadataInput = z.infer<typeof EditMetadataInputSchema>;

/** qpdf AES-256; the owner password is always set. */
export const ProtectInputSchema = z
  .object({
    filePath: z.string().min(1),
    userPassword: z.string().optional(),
    ownerPassword: z.string().min(1),
    allowPrinting: z.boolean().default(true),
    allowCopying: z.boolean().default(false),
  })
  .strict();
export type ProtectInput = z.infer<typeof ProtectInputSchema>;

export const UnlockInputSchema = z
  .object({
    filePath: z.string().min(1),
    password: z.string(),
  })
  .strict();
export type UnlockInput = z.infer<typeof UnlockInputSchema>;

/** Flattens annotations + form fields via qpdf. */
export const FlattenInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type FlattenInput = z.infer<typeof FlattenInputSchema>;

/** Strips both the info dict and the XMP metadata stream. */
export const RemoveMetadataInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type RemoveMetadataInput = z.infer<typeof RemoveMetadataInputSchema>;

/** Data result: page counts, per-page dimensions and low-dpi pixel diff pages. */
export const ComparePdfsInputSchema = z
  .object({
    filePaths: z.array(z.string().min(1)).length(2),
  })
  .strict();
export type ComparePdfsInput = z.infer<typeof ComparePdfsInputSchema>;

/** Single basename.zip output. */
export const PdfsToZipInputSchema = z
  .object({
    filePaths: z.array(z.string().min(1)).min(2).max(100),
  })
  .strict();
export type PdfsToZipInput = z.infer<typeof PdfsToZipInputSchema>;

/** Renders each page to an image and rebuilds a single image-only PDF. */
export const RasterizeInputSchema = z
  .object({
    filePath: z.string().min(1),
    dpi: z.number().int().min(72).max(600).default(150),
  })
  .strict();
export type RasterizeInput = z.infer<typeof RasterizeInputSchema>;

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

/**
 * For tools that return structured data rather than a file (viewMetadata,
 * pageDimensions); the engine wraps the object as { jobId, data }.
 */
export const DataResultSchema = z.object({
  jobId: z.string().uuid(),
  data: z.unknown().refine((v) => v !== undefined, "data must be defined"),
});
export type DataResult = z.infer<typeof DataResultSchema>;

/** Result data for viewMetadata (the engine's MetadataData). */
export type MetadataData = {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  pageCount: number;
  fileSizeBytes: number;
};

/** Result data for pageDimensions (the engine's PageDimensionsData). */
export type PageDimensionsData = {
  pages: Array<{
    widthPt: number;
    heightPt: number;
    widthMm: number;
    heightMm: number;
    orientation: "portrait" | "landscape";
    rotation: number;
    displayed: { width: number; height: number };
  }>;
};

/**
 * Result data for comparePdfs (the engine's ComparePdfsData). It is a visual
 * similarity check, not a pixel-perfect one: only the pages both documents
 * share are compared, and page numbers are 1-based.
 */
export type ComparePdfsData = {
  pageCountA: number;
  pageCountB: number;
  samePageCounts: boolean;
  differingPages: number[];
  pageSizeMismatchPages: number[];
};
