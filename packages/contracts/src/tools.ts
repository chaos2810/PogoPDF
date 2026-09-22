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
  officeToPdf: "officeToPdf",
  ebookToPdf: "ebookToPdf",
  xpsToPdf: "xpsToPdf",
  comicToPdf: "comicToPdf",
  ocr: "ocr",
  extractTables: "extractTables",
  pdfToMarkdown: "pdfToMarkdown",
  prepareForAi: "prepareForAi",
  addAttachments: "addAttachments",
  extractAttachments: "extractAttachments",
  editAttachments: "editAttachments",
  viewBookmarks: "viewBookmarks",
  editBookmarks: "editBookmarks",
  toc: "toc",
  editorSave: "editorSave",
  search: "search",
  formFields: "formFields",
  formFill: "formFill",
  formCreate: "formCreate",
  sign: "sign",
  stamp: "stamp",
  removeAnnotations: "removeAnnotations",
  removeBlankPages: "removeBlankPages",
  removeRestrictions: "removeRestrictions",
  sanitize: "sanitize",
  bates: "bates",
  pageLabels: "pageLabels",
  editText: "editText",
  pdfToPdfA: "pdfToPdfA",
  fontOutline: "fontOutline",
  deskew: "deskew",
  scannerEffect: "scannerEffect",
  adjustColors: "adjustColors",
  invertColors: "invertColors",
  posterize: "posterize",
  backgroundColor: "backgroundColor",
  changeTextColor: "changeTextColor",
  overlay: "overlay",
  workflow: "workflow",
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
    startNumber: z.number().int().min(1).default(1),
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

/** Office/ODF input (docx/xlsx/pptx/odt/rtf, etc); the extension drives the filter. */
export const OfficeToPdfInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type OfficeToPdfInput = z.infer<typeof OfficeToPdfInputSchema>;

/** EPUB/FB2: mupdf lays the book out onto A4 pages. */
export const EbookToPdfInputSchema = z
  .object({
    filePath: z.string().min(1),
    fontSize: z.number().int().min(6).max(72).default(12),
    margins: z.number().min(0).max(144).default(72),
  })
  .strict();
export type EbookToPdfInput = z.infer<typeof EbookToPdfInputSchema>;

export const XpsToPdfInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type XpsToPdfInput = z.infer<typeof XpsToPdfInputSchema>;

/** v1 CBZ only (zip of images); named generically to allow CBR later. */
export const ComicToPdfInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type ComicToPdfInput = z.infer<typeof ComicToPdfInputSchema>;

/**
 * searchableOutput=true (default) places an invisible OCR text layer under the
 * page image; false emits a plain .txt per page (multi-output).
 */
export const OcrInputSchema = z
  .object({
    filePath: z.string().min(1),
    language: z
      .enum(["eng", "chi_tra", "chi_sim", "jpn", "kor", "deu", "fra", "spa"])
      .default("eng"),
    pages: z.string().optional(),
    dpi: z.number().int().min(72).max(600).default(150),
    searchableOutput: z.boolean().default(true),
  })
  .strict();
export type OcrInput = z.infer<typeof OcrInputSchema>;

/** v1 detects tables by clustering text-item x-gaps; best on ruled/simple tables. */
export const ExtractTablesInputSchema = z
  .object({
    filePath: z.string().min(1),
    pages: z.string().optional(),
    format: z.enum(["csv", "json", "markdown"]).default("csv"),
  })
  .strict();
export type ExtractTablesInput = z.infer<typeof ExtractTablesInputSchema>;

/** v1 detects headings from pdf.js font-size heuristics. */
export const PdfToMarkdownInputSchema = z
  .object({
    filePath: z.string().min(1),
    pages: z.string().optional(),
  })
  .strict();
export type PdfToMarkdownInput = z.infer<typeof PdfToMarkdownInputSchema>;

/** LlamaIndex-style JSON document: { pages: [{ text, page }] } + metadata. */
export const PrepareForAiInputSchema = z
  .object({
    filePath: z.string().min(1),
    pages: z.string().optional(),
  })
  .strict();
export type PrepareForAiInput = z.infer<typeof PrepareForAiInputSchema>;

export const AddAttachmentsInputSchema = z
  .object({
    filePath: z.string().min(1),
    attachments: z.array(z.string().min(1)).min(1).max(50),
  })
  .strict();
export type AddAttachmentsInput = z.infer<typeof AddAttachmentsInputSchema>;

/** Multi-output: every embedded file extracted to disk. */
export const ExtractAttachmentsInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type ExtractAttachmentsInput = z.infer<typeof ExtractAttachmentsInputSchema>;

/** v1 remove-only; removeNames defaults to [] (nothing removed). */
export const EditAttachmentsInputSchema = z
  .object({
    filePath: z.string().min(1),
    removeNames: z.array(z.string()).default([]),
  })
  .strict();
export type EditAttachmentsInput = z.infer<typeof EditAttachmentsInputSchema>;

/** Recursive bookmark tree node; page is 1-based. */
export const BookmarkNodeSchema: z.ZodType<BookmarkNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z
    .object({
      title: z.string(),
      page: z.number().int().min(1),
      children: z.array(BookmarkNodeSchema).default([]),
    })
    .strict(),
);
export type BookmarkNode = {
  title: string;
  page: number;
  children: BookmarkNode[];
};

/** Data result: { bookmarks: BookmarkNode[] }. */
export const ViewBookmarksInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type ViewBookmarksInput = z.infer<typeof ViewBookmarksInputSchema>;

/**
 * Replaces the whole outline (the UI editor is the source of truth after View).
 * An empty list is valid and clears the outline (writeBookmarks deletes the
 * catalog's /Outlines entry).
 */
export const EditBookmarksInputSchema = z
  .object({
    filePath: z.string().min(1),
    bookmarks: z.array(BookmarkNodeSchema).min(0),
  })
  .strict();
export type EditBookmarksInput = z.infer<typeof EditBookmarksInputSchema>;

/** Generates a TOC page from the existing outline; requires bookmarks present. */
export const TocInputSchema = z
  .object({
    filePath: z.string().min(1),
    position: z.enum(["after-cover", "beginning"]).default("beginning"),
    title: z.string().default("Table of Contents"),
  })
  .strict();
export type TocInput = z.infer<typeof TocInputSchema>;

/** The shared annotation model for the editor; rects use the displayed frame. */
export const ANNOTATION_TYPES = [
  "text",
  "highlight",
  "underline",
  "strikeout",
  "rect",
  "ellipse",
  "line",
  "arrow",
  "freehand",
  "redact",
  "image",
  "freetext",
] as const;

export const AnnotationColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be a #RRGGBB hex string");

export const AnnotationRectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  })
  .strict();
export type AnnotationRect = z.infer<typeof AnnotationRectSchema>;

export const AnnotationPointSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();
export type AnnotationPoint = z.infer<typeof AnnotationPointSchema>;

export const AnnotationSchema = z
  .object({
    type: z.enum(ANNOTATION_TYPES),
    page: z.number().int().min(1),
    color: AnnotationColorSchema.default("#DC2626"),
    opacity: z.number().min(0.05).max(1).default(1),
    lineWidth: z.number().min(0.5).max(12).default(2),
    rect: AnnotationRectSchema.optional(),
    points: z.array(AnnotationPointSchema).min(2).optional(),
    text: z.string().optional(),
    imagePath: z.string().optional(),
    fontSize: z.number().default(14),
  })
  .strict()
  .superRefine((v, ctx) => {
    const requireRect = () => {
      if (v.rect === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rect"],
          message: `rect is required for ${v.type} annotations`,
        });
      }
    };
    switch (v.type) {
      case "highlight":
      case "underline":
      case "strikeout":
      case "redact":
      case "rect":
      case "ellipse":
      case "line":
      case "arrow":
        requireRect();
        break;
      case "text":
        requireRect();
        if (v.text === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["text"],
            message: "text is required for text annotations",
          });
        }
        break;
      case "freetext":
        requireRect();
        if (v.text === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["text"],
            message: "text is required for freetext annotations",
          });
        }
        break;
      case "freehand":
        if (v.points === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["points"],
            message: "points is required for freehand annotations",
          });
        }
        break;
      case "image":
        if (v.imagePath === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["imagePath"],
            message: "imagePath is required for image annotations",
          });
        }
        break;
    }
  });
export type Annotation = z.infer<typeof AnnotationSchema>;

/** One save job per editor session; annotations are written as PDF annots. */
export const EditorSaveInputSchema = z
  .object({
    filePath: z.string().min(1),
    annotations: z.array(AnnotationSchema).min(1).max(1000),
  })
  .strict();
export type EditorSaveInput = z.infer<typeof EditorSaveInputSchema>;

/** Data result: { matches: [{ page, snippet, x, y }] } (max 500). */
export const SearchInputSchema = z
  .object({
    filePath: z.string().min(1),
    query: z.string().min(1).max(200),
  })
  .strict();
export type SearchInput = z.infer<typeof SearchInputSchema>;

/** Data result: { fields: [...] }; no fields is an empty list, not an error. */
export const FormFieldsInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type FormFieldsInput = z.infer<typeof FormFieldsInputSchema>;

export const FormFillInputSchema = z
  .object({
    filePath: z.string().min(1),
    values: z
      .array(
        z
          .object({
            name: z.string().min(1),
            value: z.string(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type FormFillInput = z.infer<typeof FormFillInputSchema>;

export const FormCreateFieldSchema = z
  .object({
    name: z.string().min(1),
    label: z.string(),
    type: z.enum(["text", "checkbox", "dropdown"]),
    x: z.number(),
    y: z.number(),
    w: z.number().default(150),
    h: z.number().default(24),
    options: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();
export type FormCreateField = z.infer<typeof FormCreateFieldSchema>;

export const FormCreateInputSchema = z
  .object({
    filePath: z.string().min(1),
    fields: z.array(FormCreateFieldSchema).min(1).max(200),
    page: z.number().int().min(1).default(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    v.fields.forEach((field, i) => {
      if (field.type === "dropdown" && field.options === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fields", i, "options"],
          message: "options is required for dropdown fields",
        });
      }
    });
  });
export type FormCreateInput = z.infer<typeof FormCreateInputSchema>;

export const SignInputSchema = z
  .object({
    filePath: z.string().min(1),
    mode: z.enum(["draw", "type", "image"]),
    // Draw mode: page-relative points normalized to 0..1.
    inkPoints: z
      .array(
        z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(2)
      .optional(),
    text: z.string().optional(),
    imageFile: z.string().optional(),
    page: z.number().int().min(1).default(1),
    x: z.number(),
    y: z.number(),
    scale: z.number().min(0.1).max(4).default(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.mode === "draw" && v.inkPoints === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inkPoints"],
        message: "inkPoints is required for draw mode",
      });
    }
    if (v.mode === "type" && v.text === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "text is required for type mode",
      });
    }
    if (v.mode === "image" && v.imageFile === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageFile"],
        message: "imageFile is required for image mode",
      });
    }
  });
export type SignInput = z.infer<typeof SignInputSchema>;

/** Page-drawn text stamp; text is WinAnsi-only like all page-drawn text. */
export const StampInputSchema = z
  .object({
    filePath: z.string().min(1),
    text: z.string().min(1),
    page: z.number().int().min(1).default(1),
    x: z.number(),
    y: z.number(),
    color: AnnotationColorSchema.default("#DC2626"),
    rotate: z.number().min(-360).max(360).default(0),
  })
  .strict();
export type StampInput = z.infer<typeof StampInputSchema>;

/** types omitted removes every annotation; a given subset filters by type. */
export const RemoveAnnotationsInputSchema = z
  .object({
    filePath: z.string().min(1),
    types: z.array(z.enum(ANNOTATION_TYPES)).optional(),
  })
  .strict();
export type RemoveAnnotationsInput = z.infer<typeof RemoveAnnotationsInputSchema>;

/** tolerance = percent of non-background pixels below which a page is blank. */
export const RemoveBlankPagesInputSchema = z
  .object({
    filePath: z.string().min(1),
    tolerance: z.number().int().min(0).max(100).default(5),
  })
  .strict();
export type RemoveBlankPagesInput = z.infer<typeof RemoveBlankPagesInputSchema>;

export const RemoveRestrictionsInputSchema = z
  .object({
    filePath: z.string().min(1),
    password: z.string().optional(),
  })
  .strict();
export type RemoveRestrictionsInput = z.infer<typeof RemoveRestrictionsInputSchema>;

export const SanitizeInputSchema = z
  .object({
    filePath: z.string().min(1),
    removeMetadata: z.boolean().default(true),
    removeAnnotations: z.boolean().default(true),
    removeAttachments: z.boolean().default(true),
    removeJavaScript: z.boolean().default(true),
    flattenForms: z.boolean().default(true),
  })
  .strict();
export type SanitizeInput = z.infer<typeof SanitizeInputSchema>;

/** Bates differs from pageNumbers: per-file sequence plus a prefix. */
export const BatesNumberInputSchema = z
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
    format: z.enum(["n", "prefix-n", "n-of-total"]),
    prefix: z.string().default(""),
    startNumber: z.number().int().min(0).default(1),
    fontSize: z.number().int().min(6).max(72).default(10),
    margin: z.number().min(0).max(144).default(28),
    pages: z.string().optional(),
  })
  .strict();
export type BatesNumberInput = z.infer<typeof BatesNumberInputSchema>;

/** Writes the PDF's native /PageLabels number tree (not drawn text). */
export const PageLabelsInputSchema = z
  .object({
    filePath: z.string().min(1),
    style: z.enum([
      "decimal",
      "roman-upper",
      "roman-lower",
      "letters-upper",
      "letters-lower",
      "none",
    ]),
    start: z.number().int().min(1).default(1),
    prefix: z.string().default(""),
  })
  .strict();
export type PageLabelsInput = z.infer<typeof PageLabelsInputSchema>;

/**
 * In-place text edit: each edit names a word-sized quad and its replacement.
 *
 * Coordinate convention: `quad` is in the page's UNROTATED page space in points,
 * the frame PyMuPDF (and mupdf's StructuredText) reports: origin at the page's
 * top-left, x grows right, y grows DOWN. `x`/`y` are the quad's top-left corner
 * and `w`/`h` extend right and down. The engine converts this into PyMuPDF's
 * `(x0, y0, x1, y1)` rect directly (`x1 = x + w`, `y1 = y + h`); a click on a
 * displayed (rotated) page must be mapped back to unrotated space first.
 *
 * `newText` is any non-empty Unicode string. PyMuPDF's `insert_text` accepts
 * arbitrary text, and the engine verifies CJK honestly rather than imposing a
 * Latin-1 schema limit (unlike page-drawn tools such as pageNumbers).
 */
export const EditTextInputSchema = z
  .object({
    filePath: z.string().min(1),
    edits: z
      .array(
        z
          .object({
            page: z.number().int().min(1),
            quad: z
              .object({
                x: z.number(),
                y: z.number(),
                w: z.number(),
                h: z.number(),
              })
              .strict(),
            newText: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type EditTextInput = z.infer<typeof EditTextInputSchema>;

/**
 * PDF/A archival conversion via Ghostscript. `pdfaVersion` selects the part:
 * 1b maps to `-dPDFA=1`, 2b to `-dPDFA=2`, 3b to `-dPDFA=3`; the "b"
 * conformance level is what Ghostscript's output targets in every case.
 */
export const PdfToPdfAInputSchema = z
  .object({
    filePath: z.string().min(1),
    pdfaVersion: z.enum(["1b", "2b", "3b"]).default("2b"),
  })
  .strict();
export type PdfToPdfAInput = z.infer<typeof PdfToPdfAInputSchema>;

/** Converts page text to vector outlines so the PDF needs no embedded fonts. */
export const FontOutlineInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type FontOutlineInput = z.infer<typeof FontOutlineInputSchema>;

/**
 * Straightens a scanned page: the engine detects the page's skew from a 72dpi
 * grayscale raster (projection-profile / row-ink-variance search over candidate
 * angles) and counter-rotates every page, rebuilding it at its displayed size.
 */
export const DeskewInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type DeskewInput = z.infer<typeof DeskewInputSchema>;

/**
 * Scanner-style look. bw thresholds to pure black/white, gray desaturates with
 * a contrast lift, faded lifts blacks for a washed-out photocopy feel.
 */
export const ScannerEffectInputSchema = z
  .object({
    filePath: z.string().min(1),
    preset: z.enum(["bw", "gray", "faded"]).default("gray"),
  })
  .strict();
export type ScannerEffectInput = z.infer<typeof ScannerEffectInputSchema>;

/**
 * Color correction knobs, all neutral at their defaults. brightness/contrast/
 * saturation are percentage-style offsets in -100..100; gamma is a multiplier
 * over the 1.0 identity (0.1..3). The engine applies them to each page raster.
 */
export const AdjustColorsInputSchema = z
  .object({
    filePath: z.string().min(1),
    brightness: z.number().min(-100).max(100).default(0),
    contrast: z.number().min(-100).max(100).default(0),
    saturation: z.number().min(-100).max(100).default(0),
    gamma: z.number().min(0.1).max(3).default(1),
  })
  .strict();
export type AdjustColorsInput = z.infer<typeof AdjustColorsInputSchema>;

/** Inverts every page's colors (a true per-channel invert, not luminance). */
export const InvertColorsInputSchema = z
  .object({
    filePath: z.string().min(1),
  })
  .strict();
export type InvertColorsInput = z.infer<typeof InvertColorsInputSchema>;

/** Quantizes each page's raster to `levels` steps per channel (2..32). */
export const PosterizeInputSchema = z
  .object({
    filePath: z.string().min(1),
    levels: z.number().int().min(2).max(32).default(4),
  })
  .strict();
export type PosterizeInput = z.infer<typeof PosterizeInputSchema>;

/** Fills the page background with a solid color behind the existing content. */
export const BackgroundColorInputSchema = z
  .object({
    filePath: z.string().min(1),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "color must be a #RRGGBB hex string")
      .default("#FFFFFF"),
  })
  .strict();
export type BackgroundColorInput = z.infer<typeof BackgroundColorInputSchema>;

/**
 * Approximate text recolor: the raster path tints the page's dark pixels
 * toward `color` (a documented approximation; it cannot isolate true glyph
 * pixels from dark graphics). See runChangeTextColor for the exact scope.
 */
export const ChangeTextColorInputSchema = z
  .object({
    filePath: z.string().min(1),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "color must be a #RRGGBB hex string")
      .default("#000000"),
  })
  .strict();
export type ChangeTextColorInput = z.infer<typeof ChangeTextColorInputSchema>;

/**
 * Two-document page composition. `overlay` draws the overlay document's pages
 * ON TOP of the base (z-order: base first, then overlay); `underlay` draws the
 * underlay FIRST and the base on top, so the base's opaque areas hide it.
 *
 * Page pairing is positional: overlay/underlay page i pairs with base page i.
 * When the second document has fewer pages the last one repeats to cover the
 * remaining base pages; when it has more, the extra pages are ignored.
 *
 * `scaleToFit` scales each secondary page down or up to the base page's
 * displayed frame (preserving aspect ratio) and centers it; false draws it at
 * 1:1 at the displayed origin. `opacity` applies to the secondary document only
 * (the base is always drawn fully opaque).
 */
export const OverlayInputSchema = z
  .object({
    baseFilePath: z.string().min(1),
    overlayFilePath: z.string().min(1),
    mode: z.enum(["overlay", "underlay"]),
    opacity: z.number().min(0.05).max(1).default(1),
    scaleToFit: z.boolean().default(false),
  })
  .strict();
export type OverlayInput = z.infer<typeof OverlayInputSchema>;

/**
 * One step of a workflow: a registered tool id plus that tool's input object.
 * `toolId` is a plain string (not an enum) so the registry stays the single
 * source of truth; the engine looks each id up and rejects the unknown ones.
 */
export const WorkflowStepSchema = z
  .object({
    toolId: z.string().min(1),
    input: z.record(z.unknown()),
  })
  .strict();
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/**
 * A visual pipeline: steps run sequentially IN-PROCESS (no RPC re-entry), each
 * consuming the previous step's output. A step's input MAY set `filePath` or
 * `baseFilePath` to the literal string "$previous"; it is replaced by the
 * previous step's output path before the step runs. Step 1 cannot use
 * "$previous" (there is no previous output), and a "$previous" reference after
 * a step that returned data (not a file) is rejected. `workflow` cannot be a
 * step (nested workflows are rejected). The last step's output is the result.
 */
export const WorkflowInputSchema = z
  .object({
    steps: z.array(WorkflowStepSchema).min(1).max(20),
  })
  .strict();
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

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

/**
 * Result data for search (the engine's SearchData). Positions are in the
 * page's DISPLAYED frame (x from the left, y from the top), so the UI can
 * place a highlight without knowing the page rotation. Capped at 500 matches.
 */
export type SearchData = {
  matches: Array<{
    page: number;
    snippet: string;
    x: number;
    y: number;
  }>;
};

/** Result data for formFields (the engine's FormFieldsData). */
export type FormFieldsData = {
  fields: Array<{
    name: string;
    type: "text" | "checkbox" | "radio" | "dropdown" | "signature";
    value?: string;
    options?: string[];
    readOnly: boolean;
    required: boolean;
  }>;
};
