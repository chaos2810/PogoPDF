import { describe, it, expect } from "vitest";
import {
  MergeInputSchema, JobStartParamsSchema, ProgressParamsSchema, TOOL_IDS,
  SplitInputSchema, ExtractPagesInputSchema, DeletePagesInputSchema,
  OrganizeInputSchema, RotateInputSchema, RotateCustomInputSchema,
  ReverseInputSchema, AddBlankPageInputSchema, NupInputSchema,
  BookletInputSchema, DividePagesInputSchema, CombineSinglePageInputSchema,
  AlternateMixInputSchema, DuplexCollateInputSchema, MultiFileResultSchema,
  PdfToImagesInputSchema, PdfToTextInputSchema, PdfToSvgInputSchema,
  PdfToCbzInputSchema, PdfToGreyscaleInputSchema, ExtractImagesInputSchema,
  ViewMetadataInputSchema, PageDimensionsInputSchema, FixPageSizeInputSchema,
  ImagesToPdfInputSchema, TextToPdfInputSchema, MarkdownToPdfInputSchema,
  CsvToPdfInputSchema, PageNumbersInputSchema, WatermarkInputSchema,
  CropInputSchema, HeaderFooterInputSchema, EditMetadataInputSchema,
  ProtectInputSchema, UnlockInputSchema, FlattenInputSchema,
  RemoveMetadataInputSchema, ComparePdfsInputSchema, PdfsToZipInputSchema,
  RasterizeInputSchema, DataResultSchema,
  OfficeToPdfInputSchema, EbookToPdfInputSchema, XpsToPdfInputSchema,
  ComicToPdfInputSchema, OcrInputSchema, ExtractTablesInputSchema,
  PdfToMarkdownInputSchema, PrepareForAiInputSchema, AddAttachmentsInputSchema,
  ExtractAttachmentsInputSchema, EditAttachmentsInputSchema,
  ViewBookmarksInputSchema, EditBookmarksInputSchema, BookmarkNodeSchema,
  TocInputSchema, AnnotationSchema, ANNOTATION_TYPES, EditorSaveInputSchema,
  SearchInputSchema, FormFieldsInputSchema, FormFillInputSchema,
  FormCreateInputSchema, SignInputSchema, StampInputSchema,
  RemoveAnnotationsInputSchema, RemoveBlankPagesInputSchema,
  RemoveRestrictionsInputSchema, SanitizeInputSchema, BatesNumberInputSchema,
  PageLabelsInputSchema, EditTextInputSchema,
  PdfToPdfAInputSchema, FontOutlineInputSchema,
  DeskewInputSchema, ScannerEffectInputSchema, AdjustColorsInputSchema,
  InvertColorsInputSchema, PosterizeInputSchema, BackgroundColorInputSchema,
  ChangeTextColorInputSchema, OverlayInputSchema, WorkflowInputSchema,
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
  it("rejects a filePrefix containing path separators", () => {
    expect(SplitInputSchema.safeParse({ filePath: PDF, mode: "single", filePrefix: "a/b" }).success).toBe(false);
    expect(SplitInputSchema.safeParse({ filePath: PDF, mode: "single", filePrefix: "a\\b" }).success).toBe(false);
  });
  it("accepts a plain filePrefix and an empty string", () => {
    expect(SplitInputSchema.safeParse({ filePath: PDF, mode: "single", filePrefix: "myout" }).success).toBe(true);
    // Empty is allowed here; the engine falls back to the source basename.
    expect(SplitInputSchema.safeParse({ filePath: PDF, mode: "single", filePrefix: "" }).success).toBe(true);
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
      filePath: PDF,
      pages: [{ srcIndex: 0 }, { srcIndex: 2, rotate: 90 }],
    }).success).toBe(true);
  });
  it("rejects an empty pages array", () => {
    expect(OrganizeInputSchema.safeParse({ filePath: PDF, pages: [] }).success).toBe(false);
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

describe("PdfToImagesInputSchema", () => {
  it("accepts png with default dpi and no quality", () => {
    const parsed = PdfToImagesInputSchema.parse({ filePath: PDF, format: "png" });
    expect(parsed.dpi).toBe(150);
    expect(parsed.quality).toBeUndefined();
  });
  it("accepts webp with an explicit quality and pages", () => {
    const parsed = PdfToImagesInputSchema.parse({
      filePath: PDF, format: "webp", quality: 90, pages: "1-3",
    });
    expect(parsed.quality).toBe(90);
  });
  it("accepts jpg with an explicit quality", () => {
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "jpg", quality: 1 }).success).toBe(true);
  });
  it("rejects an unknown format", () => {
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "gif" }).success).toBe(false);
  });
  it("rejects quality with png", () => {
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "png", quality: 80 }).success).toBe(false);
  });
  it("rejects quality with bmp and tiff", () => {
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "bmp", quality: 80 }).success).toBe(false);
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "tiff", quality: 80 }).success).toBe(false);
  });
  it("rejects dpi below 72 and above 600", () => {
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "png", dpi: 71 }).success).toBe(false);
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "png", dpi: 601 }).success).toBe(false);
  });
  it("rejects a non-integer dpi", () => {
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "png", dpi: 150.5 }).success).toBe(false);
  });
  it("rejects quality outside 1..100", () => {
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "jpg", quality: 0 }).success).toBe(false);
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "jpg", quality: 101 }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(PdfToImagesInputSchema.safeParse({ filePath: PDF, format: "png", extra: true }).success).toBe(false);
  });
});

describe("PdfToTextInputSchema", () => {
  it("accepts filePath alone (pages defaults to all)", () => {
    expect(PdfToTextInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("accepts filePath + pages", () => {
    expect(PdfToTextInputSchema.safeParse({ filePath: PDF, pages: "1,3-5" }).success).toBe(true);
  });
  it("rejects non-string pages", () => {
    expect(PdfToTextInputSchema.safeParse({ filePath: PDF, pages: [1, 2] }).success).toBe(false);
  });
});

describe("PdfToSvgInputSchema", () => {
  it("accepts filePath with default dpi", () => {
    const parsed = PdfToSvgInputSchema.parse({ filePath: PDF });
    expect(parsed.dpi).toBe(150);
  });
  it("rejects dpi below 72 and above 600", () => {
    expect(PdfToSvgInputSchema.safeParse({ filePath: PDF, dpi: 71 }).success).toBe(false);
    expect(PdfToSvgInputSchema.safeParse({ filePath: PDF, dpi: 601 }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(PdfToSvgInputSchema.safeParse({ filePath: PDF, quality: 80 }).success).toBe(false);
  });
});

describe("PdfToCbzInputSchema", () => {
  it("accepts filePath with default dpi", () => {
    const parsed = PdfToCbzInputSchema.parse({ filePath: PDF });
    expect(parsed.dpi).toBe(150);
  });
  it("rejects dpi above 600", () => {
    expect(PdfToCbzInputSchema.safeParse({ filePath: PDF, dpi: 601 }).success).toBe(false);
  });
  it("rejects a pages key via .strict()", () => {
    expect(PdfToCbzInputSchema.safeParse({ filePath: PDF, pages: "1" }).success).toBe(false);
  });
});

describe("PdfToGreyscaleInputSchema", () => {
  it("accepts filePath alone", () => {
    expect(PdfToGreyscaleInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("accepts filePath + pages", () => {
    expect(PdfToGreyscaleInputSchema.safeParse({ filePath: PDF, pages: "2-4" }).success).toBe(true);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(PdfToGreyscaleInputSchema.safeParse({ filePath: PDF, dpi: 300 }).success).toBe(false);
  });
});

describe("ExtractImagesInputSchema", () => {
  it("accepts filePath", () => {
    expect(ExtractImagesInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects an empty filePath", () => {
    expect(ExtractImagesInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
});

describe("ViewMetadataInputSchema", () => {
  it("accepts filePath", () => {
    expect(ViewMetadataInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(ViewMetadataInputSchema.safeParse({ filePath: PDF, pages: "1" }).success).toBe(false);
  });
});

describe("PageDimensionsInputSchema", () => {
  it("accepts filePath", () => {
    expect(PageDimensionsInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects a missing filePath", () => {
    expect(PageDimensionsInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("FixPageSizeInputSchema", () => {
  it("accepts a4 portrait scale", () => {
    expect(FixPageSizeInputSchema.safeParse({
      filePath: PDF, size: "a4", orientation: "portrait", fit: "scale",
    }).success).toBe(true);
  });
  it("accepts letter landscape pad", () => {
    expect(FixPageSizeInputSchema.safeParse({
      filePath: PDF, size: "letter", orientation: "landscape", fit: "pad",
    }).success).toBe(true);
  });
  it("rejects an unknown size", () => {
    expect(FixPageSizeInputSchema.safeParse({
      filePath: PDF, size: "a2", orientation: "portrait", fit: "scale",
    }).success).toBe(false);
  });
  it("rejects an unknown fit", () => {
    expect(FixPageSizeInputSchema.safeParse({
      filePath: PDF, size: "a4", orientation: "portrait", fit: "stretch",
    }).success).toBe(false);
  });
  it("rejects an unknown orientation", () => {
    expect(FixPageSizeInputSchema.safeParse({
      filePath: PDF, size: "a4", orientation: "diagonal", fit: "scale",
    }).success).toBe(false);
  });
});

describe("DataResultSchema", () => {
  it("accepts a jobId with arbitrary data", () => {
    expect(DataResultSchema.safeParse({
      jobId: "123e4567-e89b-12d3-a456-426614174000",
      data: { pageCount: 2, title: "Doc" },
    }).success).toBe(true);
  });
  it("rejects a non-uuid jobId", () => {
    expect(DataResultSchema.safeParse({ jobId: "nope", data: {} }).success).toBe(false);
  });
  it("rejects undefined data", () => {
    expect(DataResultSchema.safeParse({
      jobId: "123e4567-e89b-12d3-a456-426614174000",
      data: undefined,
    }).success).toBe(false);
  });
  it("rejects a missing data key", () => {
    expect(DataResultSchema.safeParse({
      jobId: "123e4567-e89b-12d3-a456-426614174000",
    }).success).toBe(false);
  });
});

describe("ImagesToPdfInputSchema", () => {
  it("accepts filePaths with default fit pageSize and margin", () => {
    const parsed = ImagesToPdfInputSchema.parse({ filePaths: ["a.png", "b.jpg"] });
    expect(parsed.pageSize).toBe("fit");
    expect(parsed.margin).toBe(0);
  });
  it("accepts a4 with an orientation", () => {
    expect(ImagesToPdfInputSchema.safeParse({
      filePaths: ["a.png"], pageSize: "a4", orientation: "landscape", margin: 12,
    }).success).toBe(true);
  });
  it("rejects an orientation with pageSize=fit", () => {
    expect(ImagesToPdfInputSchema.safeParse({
      filePaths: ["a.png"], pageSize: "fit", orientation: "portrait",
    }).success).toBe(false);
  });
  it("rejects an empty filePaths array", () => {
    expect(ImagesToPdfInputSchema.safeParse({ filePaths: [] }).success).toBe(false);
  });
  it("rejects a missing filePaths key", () => {
    expect(ImagesToPdfInputSchema.safeParse({}).success).toBe(false);
  });
  it("rejects margin above 72", () => {
    expect(ImagesToPdfInputSchema.safeParse({ filePaths: ["a.png"], margin: 73 }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(ImagesToPdfInputSchema.safeParse({ filePaths: ["a.png"], dpi: 300 }).success).toBe(false);
  });
});

describe("TextToPdfInputSchema", () => {
  it("accepts filePath with default fontSize and margins", () => {
    const parsed = TextToPdfInputSchema.parse({ filePath: "a.txt" });
    expect(parsed.fontSize).toBe(12);
    expect(parsed.margins).toBe(72);
  });
  it("accepts explicit fontSize and margins", () => {
    expect(TextToPdfInputSchema.safeParse({ filePath: "a.txt", fontSize: 6, margins: 144 }).success).toBe(true);
  });
  it("rejects fontSize below 6 and above 72", () => {
    expect(TextToPdfInputSchema.safeParse({ filePath: "a.txt", fontSize: 5 }).success).toBe(false);
    expect(TextToPdfInputSchema.safeParse({ filePath: "a.txt", fontSize: 73 }).success).toBe(false);
  });
  it("rejects a non-integer fontSize", () => {
    expect(TextToPdfInputSchema.safeParse({ filePath: "a.txt", fontSize: 12.5 }).success).toBe(false);
  });
  it("rejects margins above 144", () => {
    expect(TextToPdfInputSchema.safeParse({ filePath: "a.txt", margins: 145 }).success).toBe(false);
  });
});

describe("MarkdownToPdfInputSchema", () => {
  it("accepts filePath with default fontSize and margins", () => {
    const parsed = MarkdownToPdfInputSchema.parse({ filePath: "a.md" });
    expect(parsed.fontSize).toBe(12);
    expect(parsed.margins).toBe(72);
  });
  it("rejects an empty filePath", () => {
    expect(MarkdownToPdfInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(MarkdownToPdfInputSchema.safeParse({ filePath: "a.md", theme: "dark" }).success).toBe(false);
  });
});

describe("CsvToPdfInputSchema", () => {
  it("accepts filePath with default fontSize and portrait orientation", () => {
    const parsed = CsvToPdfInputSchema.parse({ filePath: "a.csv" });
    expect(parsed.fontSize).toBe(10);
    expect(parsed.orientation).toBe("portrait");
  });
  it("accepts landscape with an explicit fontSize", () => {
    expect(CsvToPdfInputSchema.safeParse({ filePath: "a.csv", fontSize: 6, orientation: "landscape" }).success).toBe(true);
  });
  it("rejects an unknown orientation", () => {
    expect(CsvToPdfInputSchema.safeParse({ filePath: "a.csv", orientation: "diagonal" }).success).toBe(false);
  });
  it("rejects fontSize above 72", () => {
    expect(CsvToPdfInputSchema.safeParse({ filePath: "a.csv", fontSize: 73 }).success).toBe(false);
  });
});

describe("PageNumbersInputSchema", () => {
  it("accepts position + format with defaults", () => {
    const parsed = PageNumbersInputSchema.parse({
      filePath: PDF, position: "bottom-center", format: "n",
    });
    expect(parsed.startNumber).toBe(1);
    expect(parsed.fontSize).toBe(10);
    expect(parsed.margin).toBe(28);
    expect(parsed.skipFirst).toBe(false);
  });
  it("accepts an explicit startNumber, pages and skipFirst", () => {
    expect(PageNumbersInputSchema.safeParse({
      filePath: PDF, position: "top-left", format: "n-of-total",
      startNumber: 1, fontSize: 6, margin: 0, pages: "2-4", skipFirst: true,
    }).success).toBe(true);
  });
  it("rejects startNumber below 1", () => {
    for (const startNumber of [0, -3]) {
      expect(PageNumbersInputSchema.safeParse({
        filePath: PDF, position: "bottom-center", format: "n", startNumber,
      }).success).toBe(false);
    }
  });
  it("rejects an unknown position", () => {
    expect(PageNumbersInputSchema.safeParse({
      filePath: PDF, position: "middle", format: "n",
    }).success).toBe(false);
  });
  it("rejects an unknown format", () => {
    expect(PageNumbersInputSchema.safeParse({
      filePath: PDF, position: "bottom-center", format: "roman",
    }).success).toBe(false);
  });
  it("rejects a missing format", () => {
    expect(PageNumbersInputSchema.safeParse({ filePath: PDF, position: "bottom-center" }).success).toBe(false);
  });
  it("rejects a non-integer startNumber", () => {
    expect(PageNumbersInputSchema.safeParse({
      filePath: PDF, position: "bottom-center", format: "n", startNumber: 1.5,
    }).success).toBe(false);
  });
});

describe("WatermarkInputSchema", () => {
  it("accepts text alone with defaults", () => {
    const parsed = WatermarkInputSchema.parse({ filePath: PDF, text: "DRAFT" });
    expect(parsed.opacity).toBe(0.15);
    expect(parsed.fontSize).toBe(48);
    expect(parsed.rotation).toBe(45);
    expect(parsed.color).toBe("#808080");
    expect(parsed.position).toBe("center");
  });
  it("accepts imagePath alone with explicit options", () => {
    expect(WatermarkInputSchema.safeParse({
      filePath: PDF, imagePath: "logo.png", opacity: 1, fontSize: 6,
      rotation: -360, pages: "1-3",
    }).success).toBe(true);
  });
  it("rejects a tile position with an image source", () => {
    expect(WatermarkInputSchema.safeParse({
      filePath: PDF, imagePath: "logo.png", position: "tile",
    }).success).toBe(false);
  });
  it("rejects an explicit color with an image source", () => {
    expect(WatermarkInputSchema.safeParse({
      filePath: PDF, imagePath: "logo.png", color: "#808080",
    }).success).toBe(false);
  });
  it("accepts a tile position for text", () => {
    expect(WatermarkInputSchema.safeParse({
      filePath: PDF, text: "DRAFT", position: "tile",
    }).success).toBe(true);
  });
  it("rejects both text and imagePath", () => {
    expect(WatermarkInputSchema.safeParse({
      filePath: PDF, text: "DRAFT", imagePath: "logo.png",
    }).success).toBe(false);
  });
  it("rejects neither text nor imagePath", () => {
    expect(WatermarkInputSchema.safeParse({ filePath: PDF }).success).toBe(false);
  });
  it("rejects opacity below 0.05 and above 1", () => {
    expect(WatermarkInputSchema.safeParse({ filePath: PDF, text: "x", opacity: 0.04 }).success).toBe(false);
    expect(WatermarkInputSchema.safeParse({ filePath: PDF, text: "x", opacity: 1.01 }).success).toBe(false);
  });
  it("rejects rotation beyond ±360", () => {
    expect(WatermarkInputSchema.safeParse({ filePath: PDF, text: "x", rotation: 361 }).success).toBe(false);
    expect(WatermarkInputSchema.safeParse({ filePath: PDF, text: "x", rotation: -361 }).success).toBe(false);
  });
  it("rejects a malformed color hex string", () => {
    expect(WatermarkInputSchema.safeParse({ filePath: PDF, text: "x", color: "red" }).success).toBe(false);
    expect(WatermarkInputSchema.safeParse({ filePath: PDF, text: "x", color: "#fff" }).success).toBe(false);
  });
  it("rejects an unknown position", () => {
    expect(WatermarkInputSchema.safeParse({ filePath: PDF, text: "x", position: "corner" }).success).toBe(false);
  });
  it("accepts fontSize up to 200 and rejects beyond", () => {
    expect(WatermarkInputSchema.safeParse({ filePath: PDF, text: "x", fontSize: 200 }).success).toBe(true);
    expect(WatermarkInputSchema.safeParse({ filePath: PDF, text: "x", fontSize: 201 }).success).toBe(false);
    expect(WatermarkInputSchema.safeParse({ filePath: PDF, text: "x", fontSize: 5 }).success).toBe(false);
  });
});

describe("CropInputSchema", () => {
  it("accepts a non-zero inset with defaults for the rest", () => {
    const parsed = CropInputSchema.parse({ filePath: PDF, top: 10 });
    expect(parsed.top).toBe(10);
    expect(parsed.bottom).toBe(0);
    expect(parsed.left).toBe(0);
    expect(parsed.right).toBe(0);
  });
  it("accepts all four edges and pages", () => {
    expect(CropInputSchema.safeParse({
      filePath: PDF, top: 5, bottom: 5, left: 5, right: 5, pages: "1-2",
    }).success).toBe(true);
  });
  it("rejects all-zero insets (no-op crop)", () => {
    expect(CropInputSchema.safeParse({
      filePath: PDF, top: 0, bottom: 0, left: 0, right: 0,
    }).success).toBe(false);
  });
  it("rejects a negative inset", () => {
    expect(CropInputSchema.safeParse({ filePath: PDF, top: -1 }).success).toBe(false);
  });
  it("rejects an inset above 500", () => {
    expect(CropInputSchema.safeParse({ filePath: PDF, right: 501 }).success).toBe(false);
  });
});

describe("HeaderFooterInputSchema", () => {
  it("accepts a header alone with defaults", () => {
    const parsed = HeaderFooterInputSchema.parse({ filePath: PDF, header: "Title" });
    expect(parsed.fontSize).toBe(10);
    expect(parsed.margin).toBe(28);
  });
  it("accepts a footer alone", () => {
    expect(HeaderFooterInputSchema.safeParse({ filePath: PDF, footer: "Page" }).success).toBe(true);
  });
  it("accepts both with explicit options", () => {
    expect(HeaderFooterInputSchema.safeParse({
      filePath: PDF, header: "H", footer: "F", fontSize: 6, margin: 0, pages: "1",
    }).success).toBe(true);
  });
  it("rejects neither header nor footer", () => {
    expect(HeaderFooterInputSchema.safeParse({ filePath: PDF }).success).toBe(false);
  });
  it("rejects both empty after trim", () => {
    expect(HeaderFooterInputSchema.safeParse({ filePath: PDF, header: "  ", footer: "" }).success).toBe(false);
  });
});

describe("EditMetadataInputSchema", () => {
  it("accepts a string value and a null (remove) value", () => {
    const parsed = EditMetadataInputSchema.parse({ filePath: PDF, title: "New", author: null });
    expect(parsed.title).toBe("New");
    expect(parsed.author).toBeNull();
  });
  it("accepts an omitted field as undefined (leave unchanged)", () => {
    const parsed = EditMetadataInputSchema.parse({ filePath: PDF, title: "New" });
    expect(parsed.author).toBeUndefined();
  });
  it("rejects a number field value", () => {
    expect(EditMetadataInputSchema.safeParse({ filePath: PDF, title: 5 }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(EditMetadataInputSchema.safeParse({ filePath: PDF, creationDate: "now" }).success).toBe(false);
  });
});

describe("ProtectInputSchema", () => {
  it("accepts an ownerPassword with permission defaults", () => {
    const parsed = ProtectInputSchema.parse({ filePath: PDF, ownerPassword: "secret" });
    expect(parsed.allowPrinting).toBe(true);
    expect(parsed.allowCopying).toBe(false);
    expect(parsed.userPassword).toBeUndefined();
  });
  it("accepts user + owner passwords and explicit permissions", () => {
    expect(ProtectInputSchema.safeParse({
      filePath: PDF, userPassword: "u", ownerPassword: "o",
      allowPrinting: false, allowCopying: true,
    }).success).toBe(true);
  });
  it("rejects a missing ownerPassword", () => {
    expect(ProtectInputSchema.safeParse({ filePath: PDF, userPassword: "u" }).success).toBe(false);
  });
  it("rejects an empty ownerPassword", () => {
    expect(ProtectInputSchema.safeParse({ filePath: PDF, ownerPassword: "" }).success).toBe(false);
  });
});

describe("UnlockInputSchema", () => {
  it("accepts filePath + password", () => {
    expect(UnlockInputSchema.safeParse({ filePath: PDF, password: "secret" }).success).toBe(true);
  });
  it("accepts an empty password", () => {
    expect(UnlockInputSchema.safeParse({ filePath: PDF, password: "" }).success).toBe(true);
  });
  it("rejects a missing password", () => {
    expect(UnlockInputSchema.safeParse({ filePath: PDF }).success).toBe(false);
  });
});

describe("FlattenInputSchema", () => {
  it("accepts filePath", () => {
    expect(FlattenInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(FlattenInputSchema.safeParse({ filePath: PDF, pages: "1" }).success).toBe(false);
  });
});

describe("RemoveMetadataInputSchema", () => {
  it("accepts filePath", () => {
    expect(RemoveMetadataInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects an empty filePath", () => {
    expect(RemoveMetadataInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
});

describe("ComparePdfsInputSchema", () => {
  it("accepts exactly two paths", () => {
    expect(ComparePdfsInputSchema.safeParse({ filePaths: ["a.pdf", "b.pdf"] }).success).toBe(true);
  });
  it("rejects one path", () => {
    expect(ComparePdfsInputSchema.safeParse({ filePaths: ["a.pdf"] }).success).toBe(false);
  });
  it("rejects three paths", () => {
    expect(ComparePdfsInputSchema.safeParse({ filePaths: ["a.pdf", "b.pdf", "c.pdf"] }).success).toBe(false);
  });
});

describe("PdfsToZipInputSchema", () => {
  it("accepts two to 100 paths", () => {
    expect(PdfsToZipInputSchema.safeParse({ filePaths: ["a.pdf", "b.pdf"] }).success).toBe(true);
  });
  it("rejects a single path", () => {
    expect(PdfsToZipInputSchema.safeParse({ filePaths: ["a.pdf"] }).success).toBe(false);
  });
  it("rejects 101 paths", () => {
    const many = Array.from({ length: 101 }, (_, i) => `f${i}.pdf`);
    expect(PdfsToZipInputSchema.safeParse({ filePaths: many }).success).toBe(false);
  });
});

describe("RasterizeInputSchema", () => {
  it("accepts filePath with default dpi", () => {
    const parsed = RasterizeInputSchema.parse({ filePath: PDF });
    expect(parsed.dpi).toBe(150);
  });
  it("accepts an explicit dpi", () => {
    expect(RasterizeInputSchema.safeParse({ filePath: PDF, dpi: 600 }).success).toBe(true);
  });
  it("rejects dpi below 72 and above 600", () => {
    expect(RasterizeInputSchema.safeParse({ filePath: PDF, dpi: 71 }).success).toBe(false);
    expect(RasterizeInputSchema.safeParse({ filePath: PDF, dpi: 601 }).success).toBe(false);
  });
  it("rejects a non-integer dpi", () => {
    expect(RasterizeInputSchema.safeParse({ filePath: PDF, dpi: 150.5 }).success).toBe(false);
  });
});

describe("OfficeToPdfInputSchema", () => {
  it("accepts filePath", () => {
    expect(OfficeToPdfInputSchema.safeParse({ filePath: "C:\\a.docx" }).success).toBe(true);
  });
  it("rejects an empty filePath", () => {
    expect(OfficeToPdfInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(OfficeToPdfInputSchema.safeParse({ filePath: "a.docx", format: "docx" }).success).toBe(false);
  });
});

describe("EbookToPdfInputSchema", () => {
  it("accepts filePath with default fontSize and margins", () => {
    const parsed = EbookToPdfInputSchema.parse({ filePath: "a.epub" });
    expect(parsed.fontSize).toBe(12);
    expect(parsed.margins).toBe(72);
  });
  it("rejects fontSize above 72 and non-integer fontSize", () => {
    expect(EbookToPdfInputSchema.safeParse({ filePath: "a.epub", fontSize: 73 }).success).toBe(false);
    expect(EbookToPdfInputSchema.safeParse({ filePath: "a.epub", fontSize: 12.5 }).success).toBe(false);
  });
  it("rejects margins above 144", () => {
    expect(EbookToPdfInputSchema.safeParse({ filePath: "a.epub", margins: 145 }).success).toBe(false);
  });
});

describe("XpsToPdfInputSchema", () => {
  it("accepts filePath", () => {
    expect(XpsToPdfInputSchema.safeParse({ filePath: "a.xps" }).success).toBe(true);
  });
  it("rejects a missing filePath", () => {
    expect(XpsToPdfInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("ComicToPdfInputSchema", () => {
  it("accepts filePath", () => {
    expect(ComicToPdfInputSchema.safeParse({ filePath: "a.cbz" }).success).toBe(true);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(ComicToPdfInputSchema.safeParse({ filePath: "a.cbz", dpi: 150 }).success).toBe(false);
  });
});

describe("OcrInputSchema", () => {
  it("accepts filePath + language with defaults", () => {
    const parsed = OcrInputSchema.parse({ filePath: PDF, language: "eng" });
    expect(parsed.dpi).toBe(150);
    expect(parsed.searchableOutput).toBe(true);
    expect(parsed.pages).toBeUndefined();
  });
  it("accepts an explicit language, pages, dpi and searchableOutput", () => {
    expect(OcrInputSchema.safeParse({
      filePath: PDF, language: "chi_tra", pages: "1-3", dpi: 600, searchableOutput: false,
    }).success).toBe(true);
  });
  it("rejects an unknown language code", () => {
    expect(OcrInputSchema.safeParse({ filePath: PDF, language: "xxx" }).success).toBe(false);
  });
  it("defaults an omitted language to eng", () => {
    expect(OcrInputSchema.parse({ filePath: PDF }).language).toBe("eng");
  });
  it("rejects dpi below 72, above 600 and non-integer", () => {
    expect(OcrInputSchema.safeParse({ filePath: PDF, language: "eng", dpi: 71 }).success).toBe(false);
    expect(OcrInputSchema.safeParse({ filePath: PDF, language: "eng", dpi: 601 }).success).toBe(false);
    expect(OcrInputSchema.safeParse({ filePath: PDF, language: "eng", dpi: 150.5 }).success).toBe(false);
  });
});

describe("ExtractTablesInputSchema", () => {
  it("accepts filePath with default csv format", () => {
    const parsed = ExtractTablesInputSchema.parse({ filePath: PDF });
    expect(parsed.format).toBe("csv");
  });
  it("accepts an explicit format and pages", () => {
    expect(ExtractTablesInputSchema.safeParse({ filePath: PDF, pages: "2", format: "markdown" }).success).toBe(true);
  });
  it("rejects an unknown format", () => {
    expect(ExtractTablesInputSchema.safeParse({ filePath: PDF, format: "xlsx" }).success).toBe(false);
  });
});

describe("PdfToMarkdownInputSchema", () => {
  it("accepts filePath alone", () => {
    expect(PdfToMarkdownInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects non-string pages", () => {
    expect(PdfToMarkdownInputSchema.safeParse({ filePath: PDF, pages: 1 }).success).toBe(false);
  });
});

describe("PrepareForAiInputSchema", () => {
  it("accepts filePath + pages", () => {
    expect(PrepareForAiInputSchema.safeParse({ filePath: PDF, pages: "1-2" }).success).toBe(true);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(PrepareForAiInputSchema.safeParse({ filePath: PDF, model: "gpt" }).success).toBe(false);
  });
});

describe("AddAttachmentsInputSchema", () => {
  it("accepts filePath with one attachment", () => {
    expect(AddAttachmentsInputSchema.safeParse({ filePath: PDF, attachments: ["a.txt"] }).success).toBe(true);
  });
  it("rejects an empty attachments array (min 1)", () => {
    expect(AddAttachmentsInputSchema.safeParse({ filePath: PDF, attachments: [] }).success).toBe(false);
  });
  it("rejects more than 50 attachments", () => {
    const many = Array.from({ length: 51 }, (_, i) => `f${i}.txt`);
    expect(AddAttachmentsInputSchema.safeParse({ filePath: PDF, attachments: many }).success).toBe(false);
  });
});

describe("ExtractAttachmentsInputSchema", () => {
  it("accepts filePath", () => {
    expect(ExtractAttachmentsInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects an empty filePath", () => {
    expect(ExtractAttachmentsInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
});

describe("EditAttachmentsInputSchema", () => {
  it("defaults removeNames to an empty array", () => {
    const parsed = EditAttachmentsInputSchema.parse({ filePath: PDF });
    expect(parsed.removeNames).toEqual([]);
  });
  it("accepts explicit removeNames", () => {
    expect(EditAttachmentsInputSchema.safeParse({ filePath: PDF, removeNames: ["a.txt"] }).success).toBe(true);
  });
  it("rejects a non-array removeNames", () => {
    expect(EditAttachmentsInputSchema.safeParse({ filePath: PDF, removeNames: "a.txt" }).success).toBe(false);
  });
});

describe("BookmarkNodeSchema", () => {
  it("accepts a node with defaulted empty children", () => {
    const parsed = BookmarkNodeSchema.parse({ title: "Chapter 1", page: 1 });
    expect(parsed.children).toEqual([]);
  });
  it("accepts a deep nested tree (grandchild)", () => {
    expect(BookmarkNodeSchema.safeParse({
      title: "Ch 1", page: 1,
      children: [{
        title: "Sec 1.1", page: 2,
        children: [{ title: "Sub 1.1.1", page: 3, children: [] }],
      }],
    }).success).toBe(true);
  });
  it("rejects page below 1", () => {
    expect(BookmarkNodeSchema.safeParse({ title: "x", page: 0 }).success).toBe(false);
  });
  it("rejects an unknown key via .strict()", () => {
    expect(BookmarkNodeSchema.safeParse({ title: "x", page: 1, color: "red" }).success).toBe(false);
  });
});

describe("ViewBookmarksInputSchema", () => {
  it("accepts filePath", () => {
    expect(ViewBookmarksInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(ViewBookmarksInputSchema.safeParse({ filePath: PDF, depth: 2 }).success).toBe(false);
  });
});

describe("EditBookmarksInputSchema", () => {
  it("accepts a bookmark tree and keeps recursion intact", () => {
    const parsed = EditBookmarksInputSchema.parse({
      filePath: PDF,
      bookmarks: [{
        title: "Ch 1", page: 1,
        children: [{
          title: "Sec 1.1", page: 2,
          children: [{ title: "Sub 1.1.1", page: 3 }],
        }],
      }],
    });
    expect(parsed.bookmarks[0].children[0].children[0].title).toBe("Sub 1.1.1");
  });
  it("accepts an empty bookmarks array (clears the outline)", () => {
    const parsed = EditBookmarksInputSchema.parse({ filePath: PDF, bookmarks: [] });
    expect(parsed.bookmarks).toEqual([]);
  });
  it("still rejects unknown keys on the empty-list form via .strict()", () => {
    expect(
      EditBookmarksInputSchema.safeParse({ filePath: PDF, bookmarks: [], replace: true }).success
    ).toBe(false);
  });
  it("rejects a nested node with page below 1", () => {
    expect(EditBookmarksInputSchema.safeParse({
      filePath: PDF,
      bookmarks: [{ title: "Ch 1", page: 1, children: [{ title: "bad", page: 0 }] }],
    }).success).toBe(false);
  });
});

describe("TocInputSchema", () => {
  it("accepts filePath with default position and title", () => {
    const parsed = TocInputSchema.parse({ filePath: PDF });
    expect(parsed.position).toBe("beginning");
    expect(parsed.title).toBe("Table of Contents");
  });
  it("accepts an explicit position and title", () => {
    expect(TocInputSchema.safeParse({
      filePath: PDF, position: "after-cover", title: "Contents",
    }).success).toBe(true);
  });
  it("rejects an unknown position", () => {
    expect(TocInputSchema.safeParse({ filePath: PDF, position: "end" }).success).toBe(false);
  });
});

describe("AnnotationSchema", () => {
  const RECT = { x: 10, y: 20, w: 100, h: 30 };
  it("accepts all 12 types with their required fields", () => {
    const accepts: Record<(typeof ANNOTATION_TYPES)[number], unknown> = {
      text: { type: "text", page: 1, rect: RECT, text: "Note" },
      highlight: { type: "highlight", page: 1, rect: RECT },
      underline: { type: "underline", page: 2, rect: RECT },
      strikeout: { type: "strikeout", page: 2, rect: RECT },
      rect: { type: "rect", page: 1, rect: RECT },
      ellipse: { type: "ellipse", page: 1, rect: RECT },
      line: { type: "line", page: 1, rect: RECT },
      arrow: { type: "arrow", page: 1, rect: RECT },
      freehand: { type: "freehand", page: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      redact: { type: "redact", page: 3, rect: RECT },
      image: { type: "image", page: 1, imagePath: "sig.png", rect: RECT },
      freetext: { type: "freetext", page: 1, rect: RECT, text: "Hi" },
    };
    for (const type of ANNOTATION_TYPES) {
      expect(AnnotationSchema.safeParse(accepts[type]).success).toBe(true);
    }
  });
  it("defaults color, opacity, lineWidth and fontSize", () => {
    const parsed = AnnotationSchema.parse({ type: "rect", page: 1, rect: RECT });
    expect(parsed.color).toBe("#DC2626");
    expect(parsed.opacity).toBe(1);
    expect(parsed.lineWidth).toBe(2);
    expect(parsed.fontSize).toBe(14);
  });
  it("rejects freehand without points", () => {
    expect(AnnotationSchema.safeParse({ type: "freehand", page: 1 }).success).toBe(false);
  });
  it("rejects image without imagePath", () => {
    expect(AnnotationSchema.safeParse({ type: "image", page: 1, rect: RECT }).success).toBe(false);
  });
  it("rejects highlight without rect", () => {
    expect(AnnotationSchema.safeParse({ type: "highlight", page: 1 }).success).toBe(false);
  });
  it("rejects freetext without text", () => {
    expect(AnnotationSchema.safeParse({ type: "freetext", page: 1, rect: RECT }).success).toBe(false);
  });
  it("rejects text without rect", () => {
    expect(AnnotationSchema.safeParse({ type: "text", page: 1, text: "x" }).success).toBe(false);
  });
  it("rejects page below 1", () => {
    expect(AnnotationSchema.safeParse({ type: "rect", page: 0, rect: RECT }).success).toBe(false);
  });
  it("rejects an unknown type", () => {
    expect(AnnotationSchema.safeParse({ type: "circle", page: 1, rect: RECT }).success).toBe(false);
  });
  it("rejects opacity below 0.05 and above 1", () => {
    expect(AnnotationSchema.safeParse({ type: "rect", page: 1, rect: RECT, opacity: 0.04 }).success).toBe(false);
    expect(AnnotationSchema.safeParse({ type: "rect", page: 1, rect: RECT, opacity: 1.01 }).success).toBe(false);
  });
  it("rejects lineWidth below 0.5 and above 12", () => {
    expect(AnnotationSchema.safeParse({ type: "rect", page: 1, rect: RECT, lineWidth: 0.4 }).success).toBe(false);
    expect(AnnotationSchema.safeParse({ type: "rect", page: 1, rect: RECT, lineWidth: 12.5 }).success).toBe(false);
  });
  it("rejects a malformed color hex string", () => {
    expect(AnnotationSchema.safeParse({ type: "rect", page: 1, rect: RECT, color: "red" }).success).toBe(false);
    expect(AnnotationSchema.safeParse({ type: "rect", page: 1, rect: RECT, color: "#fff" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(AnnotationSchema.safeParse({ type: "rect", page: 1, rect: RECT, author: "me" }).success).toBe(false);
  });
  it("rejects a rect with unknown keys via .strict()", () => {
    expect(AnnotationSchema.safeParse({
      type: "rect", page: 1, rect: { ...RECT, rotation: 90 },
    }).success).toBe(false);
  });
  it("rejects freehand with a single point (min 2)", () => {
    expect(AnnotationSchema.safeParse({ type: "freehand", page: 1, points: [{ x: 0, y: 0 }] }).success).toBe(false);
  });
});

describe("EditorSaveInputSchema", () => {
  it("accepts a filePath with one annotation", () => {
    expect(EditorSaveInputSchema.safeParse({
      filePath: PDF,
      annotations: [{ type: "rect", page: 1, rect: { x: 0, y: 0, w: 10, h: 10 } }],
    }).success).toBe(true);
  });
  it("rejects an empty annotations array (min 1)", () => {
    expect(EditorSaveInputSchema.safeParse({ filePath: PDF, annotations: [] }).success).toBe(false);
  });
  it("rejects an invalid annotation inside the array", () => {
    expect(EditorSaveInputSchema.safeParse({
      filePath: PDF,
      annotations: [{ type: "highlight", page: 1 }],
    }).success).toBe(false);
  });
  it("rejects an unknown key via .strict()", () => {
    expect(EditorSaveInputSchema.safeParse({
      filePath: PDF, annotations: [{ type: "rect", page: 1, rect: { x: 0, y: 0, w: 1, h: 1 } }], flatten: true,
    }).success).toBe(false);
  });
});

describe("SearchInputSchema", () => {
  it("accepts a filePath and query", () => {
    expect(SearchInputSchema.safeParse({ filePath: PDF, query: "invoice" }).success).toBe(true);
  });
  it("rejects an empty query", () => {
    expect(SearchInputSchema.safeParse({ filePath: PDF, query: "" }).success).toBe(false);
  });
  it("rejects a query above 200 chars", () => {
    expect(SearchInputSchema.safeParse({ filePath: PDF, query: "x".repeat(201) }).success).toBe(false);
  });
});

describe("FormFieldsInputSchema", () => {
  it("accepts filePath", () => {
    expect(FormFieldsInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects an empty filePath", () => {
    expect(FormFieldsInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
});

describe("FormFillInputSchema", () => {
  it("accepts one name/value pair", () => {
    expect(FormFillInputSchema.safeParse({
      filePath: PDF, values: [{ name: "fullName", value: "Ada" }],
    }).success).toBe(true);
  });
  it("rejects an empty values array (min 1)", () => {
    expect(FormFillInputSchema.safeParse({ filePath: PDF, values: [] }).success).toBe(false);
  });
  it("rejects an empty field name", () => {
    expect(FormFillInputSchema.safeParse({
      filePath: PDF, values: [{ name: "", value: "Ada" }],
    }).success).toBe(false);
  });
  it("rejects an unknown key inside a value entry via .strict()", () => {
    expect(FormFillInputSchema.safeParse({
      filePath: PDF, values: [{ name: "a", value: "1", flatten: true }],
    }).success).toBe(false);
  });
});

describe("FormCreateInputSchema", () => {
  it("accepts a text field with default w/h and page", () => {
    const parsed = FormCreateInputSchema.parse({
      filePath: PDF,
      fields: [{ name: "fullName", label: "Full name", type: "text", x: 40, y: 700 }],
    });
    expect(parsed.fields[0].w).toBe(150);
    expect(parsed.fields[0].h).toBe(24);
    expect(parsed.page).toBe(1);
  });
  it("accepts a dropdown field with options and a checkbox field", () => {
    expect(FormCreateInputSchema.safeParse({
      filePath: PDF, page: 2,
      fields: [
        { name: "country", label: "Country", type: "dropdown", x: 40, y: 600, options: ["US", "TW"] },
        { name: "agree", label: "Agree", type: "checkbox", x: 40, y: 560 },
      ],
    }).success).toBe(true);
  });
  it("rejects a dropdown field without options", () => {
    expect(FormCreateInputSchema.safeParse({
      filePath: PDF,
      fields: [{ name: "country", label: "Country", type: "dropdown", x: 40, y: 600 }],
    }).success).toBe(false);
  });
  it("rejects an empty fields array (min 1)", () => {
    expect(FormCreateInputSchema.safeParse({ filePath: PDF, fields: [] }).success).toBe(false);
  });
  it("rejects an unknown field type", () => {
    expect(FormCreateInputSchema.safeParse({
      filePath: PDF,
      fields: [{ name: "sig", label: "Signature", type: "signature", x: 0, y: 0 }],
    }).success).toBe(false);
  });
  it("rejects a dropdown with an empty options array", () => {
    expect(FormCreateInputSchema.safeParse({
      filePath: PDF,
      fields: [{ name: "c", label: "C", type: "dropdown", x: 0, y: 0, options: [] }],
    }).success).toBe(false);
  });
});

describe("SignInputSchema", () => {
  it("accepts draw mode with normalized ink points", () => {
    const parsed = SignInputSchema.parse({
      filePath: PDF, mode: "draw", x: 100, y: 100,
      inkPoints: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
    });
    expect(parsed.page).toBe(1);
    expect(parsed.scale).toBe(1);
  });
  it("accepts type mode with text", () => {
    expect(SignInputSchema.safeParse({
      filePath: PDF, mode: "type", text: "Ada Lovelace", x: 100, y: 100, page: 2, scale: 0.1,
    }).success).toBe(true);
  });
  it("accepts image mode with imageFile", () => {
    expect(SignInputSchema.safeParse({
      filePath: PDF, mode: "image", imageFile: "sig.png", x: 10, y: 10, scale: 4,
    }).success).toBe(true);
  });
  it("rejects draw mode without inkPoints", () => {
    expect(SignInputSchema.safeParse({ filePath: PDF, mode: "draw", x: 0, y: 0 }).success).toBe(false);
  });
  it("rejects type mode without text", () => {
    expect(SignInputSchema.safeParse({ filePath: PDF, mode: "type", x: 0, y: 0 }).success).toBe(false);
  });
  it("rejects image mode without imageFile", () => {
    expect(SignInputSchema.safeParse({ filePath: PDF, mode: "image", x: 0, y: 0 }).success).toBe(false);
  });
  it("rejects ink points outside the 0..1 range", () => {
    expect(SignInputSchema.safeParse({
      filePath: PDF, mode: "draw", x: 0, y: 0,
      inkPoints: [{ x: 0, y: 0 }, { x: 1.5, y: 0.5 }],
    }).success).toBe(false);
  });
  it("rejects scale outside 0.1..4", () => {
    expect(SignInputSchema.safeParse({
      filePath: PDF, mode: "type", text: "x", x: 0, y: 0, scale: 0.05,
    }).success).toBe(false);
    expect(SignInputSchema.safeParse({
      filePath: PDF, mode: "type", text: "x", x: 0, y: 0, scale: 4.1,
    }).success).toBe(false);
  });
  it("rejects an unknown mode", () => {
    expect(SignInputSchema.safeParse({ filePath: PDF, mode: "stamp", x: 0, y: 0 }).success).toBe(false);
  });
});

describe("StampInputSchema", () => {
  it("accepts text with page/color/rotate defaults", () => {
    const parsed = StampInputSchema.parse({ filePath: PDF, text: "APPROVED", x: 200, y: 400 });
    expect(parsed.page).toBe(1);
    expect(parsed.color).toBe("#DC2626");
    expect(parsed.rotate).toBe(0);
  });
  it("rejects empty text", () => {
    expect(StampInputSchema.safeParse({ filePath: PDF, text: "", x: 0, y: 0 }).success).toBe(false);
  });
  it("rejects rotate beyond ±360", () => {
    expect(StampInputSchema.safeParse({ filePath: PDF, text: "x", x: 0, y: 0, rotate: 361 }).success).toBe(false);
    expect(StampInputSchema.safeParse({ filePath: PDF, text: "x", x: 0, y: 0, rotate: -361 }).success).toBe(false);
  });
  it("rejects a malformed color hex string", () => {
    expect(StampInputSchema.safeParse({ filePath: PDF, text: "x", x: 0, y: 0, color: "blue" }).success).toBe(false);
  });
});

describe("RemoveAnnotationsInputSchema", () => {
  it("accepts filePath alone (removes all)", () => {
    expect(RemoveAnnotationsInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("accepts a subset of annotation types", () => {
    expect(RemoveAnnotationsInputSchema.safeParse({
      filePath: PDF, types: ["highlight", "underline"],
    }).success).toBe(true);
  });
  it("rejects a type outside the annotation enum", () => {
    expect(RemoveAnnotationsInputSchema.safeParse({ filePath: PDF, types: ["circle"] }).success).toBe(false);
  });
  it("rejects an unknown key via .strict()", () => {
    expect(RemoveAnnotationsInputSchema.safeParse({ filePath: PDF, all: true }).success).toBe(false);
  });
});

describe("RemoveBlankPagesInputSchema", () => {
  it("accepts filePath with default tolerance", () => {
    expect(RemoveBlankPagesInputSchema.parse({ filePath: PDF }).tolerance).toBe(5);
  });
  it("rejects tolerance below 0", () => {
    expect(RemoveBlankPagesInputSchema.safeParse({ filePath: PDF, tolerance: -1 }).success).toBe(false);
  });
  it("rejects tolerance above 100", () => {
    expect(RemoveBlankPagesInputSchema.safeParse({ filePath: PDF, tolerance: 101 }).success).toBe(false);
  });
  it("rejects a non-integer tolerance", () => {
    expect(RemoveBlankPagesInputSchema.safeParse({ filePath: PDF, tolerance: 5.5 }).success).toBe(false);
  });
});

describe("RemoveRestrictionsInputSchema", () => {
  it("accepts filePath alone (owner-password restrictions)", () => {
    expect(RemoveRestrictionsInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("accepts filePath with a password", () => {
    expect(RemoveRestrictionsInputSchema.safeParse({ filePath: PDF, password: "secret" }).success).toBe(true);
  });
  it("rejects a non-string password", () => {
    expect(RemoveRestrictionsInputSchema.safeParse({ filePath: PDF, password: 5 }).success).toBe(false);
  });
});

describe("SanitizeInputSchema", () => {
  it("defaults all five cleanup flags to true", () => {
    const parsed = SanitizeInputSchema.parse({ filePath: PDF });
    expect(parsed.removeMetadata).toBe(true);
    expect(parsed.removeAnnotations).toBe(true);
    expect(parsed.removeAttachments).toBe(true);
    expect(parsed.removeJavaScript).toBe(true);
    expect(parsed.flattenForms).toBe(true);
  });
  it("accepts explicit false flags", () => {
    expect(SanitizeInputSchema.safeParse({
      filePath: PDF, removeMetadata: false, removeAnnotations: false,
      removeAttachments: false, removeJavaScript: false, flattenForms: false,
    }).success).toBe(true);
  });
  it("rejects an unknown key via .strict()", () => {
    expect(SanitizeInputSchema.safeParse({ filePath: PDF, removeXmp: true }).success).toBe(false);
  });
  it("rejects a non-boolean flag", () => {
    expect(SanitizeInputSchema.safeParse({ filePath: PDF, removeMetadata: "yes" }).success).toBe(false);
  });
});

describe("BatesNumberInputSchema", () => {
  it("accepts position + format with defaults", () => {
    const parsed = BatesNumberInputSchema.parse({
      filePath: PDF, position: "bottom-right", format: "prefix-n",
    });
    expect(parsed.prefix).toBe("");
    expect(parsed.startNumber).toBe(1);
    expect(parsed.fontSize).toBe(10);
    expect(parsed.margin).toBe(28);
  });
  it("accepts an explicit prefix, startNumber and pages", () => {
    expect(BatesNumberInputSchema.safeParse({
      filePath: PDF, position: "top-center", format: "n-of-total",
      prefix: "CASE-", startNumber: 0, fontSize: 6, margin: 0, pages: "1-3",
    }).success).toBe(true);
  });
  it("rejects startNumber below 0", () => {
    expect(BatesNumberInputSchema.safeParse({
      filePath: PDF, position: "bottom-center", format: "n", startNumber: -1,
    }).success).toBe(false);
  });
  it("rejects an unknown format", () => {
    expect(BatesNumberInputSchema.safeParse({
      filePath: PDF, position: "bottom-center", format: "page-n",
    }).success).toBe(false);
  });
  it("rejects an unknown position", () => {
    expect(BatesNumberInputSchema.safeParse({
      filePath: PDF, position: "middle", format: "n",
    }).success).toBe(false);
  });
  it("rejects fontSize above 72", () => {
    expect(BatesNumberInputSchema.safeParse({
      filePath: PDF, position: "bottom-center", format: "n", fontSize: 73,
    }).success).toBe(false);
  });
});

describe("PageLabelsInputSchema", () => {
  it("accepts a style with default start and prefix", () => {
    const parsed = PageLabelsInputSchema.parse({ filePath: PDF, style: "roman-lower" });
    expect(parsed.start).toBe(1);
    expect(parsed.prefix).toBe("");
  });
  it("accepts each known style", () => {
    for (const style of ["decimal", "roman-upper", "roman-lower", "letters-upper", "letters-lower", "none"] as const) {
      expect(PageLabelsInputSchema.safeParse({ filePath: PDF, style }).success).toBe(true);
    }
  });
  it("rejects an unknown style", () => {
    expect(PageLabelsInputSchema.safeParse({ filePath: PDF, style: "roman" }).success).toBe(false);
  });
  it("rejects start below 1", () => {
    expect(PageLabelsInputSchema.safeParse({ filePath: PDF, style: "decimal", start: 0 }).success).toBe(false);
  });
  it("rejects a non-integer start", () => {
    expect(PageLabelsInputSchema.safeParse({ filePath: PDF, style: "decimal", start: 1.5 }).success).toBe(false);
  });
});

describe("EditTextInputSchema", () => {
  const edit = {
    page: 1,
    quad: { x: 10, y: 20, w: 40, h: 12 },
    newText: "Changed",
  };
  it("accepts one edit with a quad and non-empty text", () => {
    expect(EditTextInputSchema.safeParse({ filePath: PDF, edits: [edit] }).success).toBe(true);
  });
  it("accepts multiple edits across pages", () => {
    expect(
      EditTextInputSchema.safeParse({
        filePath: PDF,
        edits: [edit, { ...edit, page: 2, newText: "Other" }],
      }).success
    ).toBe(true);
  });
  it("accepts CJK replacement text (no Latin-1 schema limit)", () => {
    // PyMuPDF's insert_text takes Unicode; whether CJK renders is verified by
    // the engine probe, not by the schema. The schema must not forbid it.
    expect(
      EditTextInputSchema.safeParse({
        filePath: PDF,
        edits: [{ ...edit, newText: "第一章" }],
      }).success
    ).toBe(true);
  });
  it("rejects an empty edits array", () => {
    expect(EditTextInputSchema.safeParse({ filePath: PDF, edits: [] }).success).toBe(false);
  });
  it("rejects more than 200 edits", () => {
    const edits = Array.from({ length: 201 }, () => edit);
    expect(EditTextInputSchema.safeParse({ filePath: PDF, edits }).success).toBe(false);
  });
  it("rejects empty newText", () => {
    expect(
      EditTextInputSchema.safeParse({ filePath: PDF, edits: [{ ...edit, newText: "" }] }).success
    ).toBe(false);
  });
  it("rejects page below 1", () => {
    expect(
      EditTextInputSchema.safeParse({ filePath: PDF, edits: [{ ...edit, page: 0 }] }).success
    ).toBe(false);
  });
  it("rejects a non-integer page", () => {
    expect(
      EditTextInputSchema.safeParse({ filePath: PDF, edits: [{ ...edit, page: 1.5 }] }).success
    ).toBe(false);
  });
  it("rejects a quad missing a field", () => {
    expect(
      EditTextInputSchema.safeParse({
        filePath: PDF,
        edits: [{ page: 1, quad: { x: 10, y: 20, w: 40 }, newText: "Changed" }],
      }).success
    ).toBe(false);
  });
  it("rejects an unknown key via .strict()", () => {
    expect(
      EditTextInputSchema.safeParse({ filePath: PDF, edits: [edit], keepFont: true }).success
    ).toBe(false);
  });
});

describe("PdfToPdfAInputSchema", () => {
  it("defaults pdfaVersion to 2b", () => {
    expect(PdfToPdfAInputSchema.parse({ filePath: PDF }).pdfaVersion).toBe("2b");
  });
  it("accepts each version", () => {
    for (const pdfaVersion of ["1b", "2b", "3b"] as const) {
      expect(PdfToPdfAInputSchema.safeParse({ filePath: PDF, pdfaVersion }).success).toBe(true);
    }
  });
  it("rejects an unknown version", () => {
    expect(PdfToPdfAInputSchema.safeParse({ filePath: PDF, pdfaVersion: "4b" }).success).toBe(false);
  });
  it("rejects an empty filePath", () => {
    expect(PdfToPdfAInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(PdfToPdfAInputSchema.safeParse({ filePath: PDF, colorStrategy: "CMYK" }).success).toBe(false);
  });
});

describe("FontOutlineInputSchema", () => {
  it("accepts filePath", () => {
    expect(FontOutlineInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects an empty filePath", () => {
    expect(FontOutlineInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(FontOutlineInputSchema.safeParse({ filePath: PDF, pages: "1" }).success).toBe(false);
  });
});

describe("TOOL_IDS", () => {
  it("contains all 79 tools with values equal to their keys", () => {
    for (const [key, value] of Object.entries(TOOL_IDS)) {
      expect(value).toBe(key);
    }
    expect(Object.keys(TOOL_IDS)).toHaveLength(79);
  });
});

describe("DeskewInputSchema", () => {
  it("accepts filePath", () => {
    expect(DeskewInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects an empty filePath", () => {
    expect(DeskewInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(DeskewInputSchema.safeParse({ filePath: PDF, angle: 3 }).success).toBe(false);
  });
});

describe("ScannerEffectInputSchema", () => {
  it("defaults preset to gray", () => {
    expect(ScannerEffectInputSchema.parse({ filePath: PDF }).preset).toBe("gray");
  });
  it("accepts each preset", () => {
    for (const preset of ["bw", "gray", "faded"] as const) {
      expect(ScannerEffectInputSchema.safeParse({ filePath: PDF, preset }).success).toBe(true);
    }
  });
  it("rejects an unknown preset", () => {
    expect(ScannerEffectInputSchema.safeParse({ filePath: PDF, preset: "sepia" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(ScannerEffectInputSchema.safeParse({ filePath: PDF, preset: "gray", grain: 4 }).success).toBe(false);
  });
});

describe("AdjustColorsInputSchema", () => {
  it("defaults every knob to neutral", () => {
    const parsed = AdjustColorsInputSchema.parse({ filePath: PDF });
    expect(parsed.brightness).toBe(0);
    expect(parsed.contrast).toBe(0);
    expect(parsed.saturation).toBe(0);
    expect(parsed.gamma).toBe(1);
  });
  it("accepts the extreme ends of every range", () => {
    expect(AdjustColorsInputSchema.safeParse({
      filePath: PDF, brightness: -100, contrast: 100, saturation: -100, gamma: 0.1,
    }).success).toBe(true);
    expect(AdjustColorsInputSchema.safeParse({
      filePath: PDF, brightness: 100, contrast: -100, saturation: 100, gamma: 3,
    }).success).toBe(true);
  });
  it("rejects values outside their ranges", () => {
    expect(AdjustColorsInputSchema.safeParse({ filePath: PDF, brightness: 101 }).success).toBe(false);
    expect(AdjustColorsInputSchema.safeParse({ filePath: PDF, contrast: -101 }).success).toBe(false);
    expect(AdjustColorsInputSchema.safeParse({ filePath: PDF, saturation: 101 }).success).toBe(false);
    expect(AdjustColorsInputSchema.safeParse({ filePath: PDF, gamma: 0.09 }).success).toBe(false);
    expect(AdjustColorsInputSchema.safeParse({ filePath: PDF, gamma: 3.01 }).success).toBe(false);
  });
  it("accepts fractional knob values", () => {
    const parsed = AdjustColorsInputSchema.parse({ filePath: PDF, brightness: 1.5, contrast: -0.5, saturation: 12.25 });
    expect(parsed.brightness).toBe(1.5);
    expect(parsed.contrast).toBe(-0.5);
    expect(parsed.saturation).toBe(12.25);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(AdjustColorsInputSchema.safeParse({ filePath: PDF, hue: 10 }).success).toBe(false);
  });
});

describe("InvertColorsInputSchema", () => {
  it("accepts filePath", () => {
    expect(InvertColorsInputSchema.safeParse({ filePath: PDF }).success).toBe(true);
  });
  it("rejects an empty filePath", () => {
    expect(InvertColorsInputSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(InvertColorsInputSchema.safeParse({ filePath: PDF, pages: "1" }).success).toBe(false);
  });
});

describe("PosterizeInputSchema", () => {
  it("defaults levels to 4", () => {
    expect(PosterizeInputSchema.parse({ filePath: PDF }).levels).toBe(4);
  });
  it("accepts the range bounds 2 and 32", () => {
    expect(PosterizeInputSchema.safeParse({ filePath: PDF, levels: 2 }).success).toBe(true);
    expect(PosterizeInputSchema.safeParse({ filePath: PDF, levels: 32 }).success).toBe(true);
  });
  it("rejects levels outside 2..32", () => {
    expect(PosterizeInputSchema.safeParse({ filePath: PDF, levels: 1 }).success).toBe(false);
    expect(PosterizeInputSchema.safeParse({ filePath: PDF, levels: 33 }).success).toBe(false);
  });
  it("rejects a non-integer levels", () => {
    expect(PosterizeInputSchema.safeParse({ filePath: PDF, levels: 4.5 }).success).toBe(false);
  });
});

describe("BackgroundColorInputSchema", () => {
  it("defaults color to white", () => {
    expect(BackgroundColorInputSchema.parse({ filePath: PDF }).color).toBe("#FFFFFF");
  });
  it("accepts a lowercase hex color", () => {
    expect(BackgroundColorInputSchema.safeParse({ filePath: PDF, color: "#1c1c1a" }).success).toBe(true);
  });
  it("rejects a malformed color", () => {
    expect(BackgroundColorInputSchema.safeParse({ filePath: PDF, color: "white" }).success).toBe(false);
    expect(BackgroundColorInputSchema.safeParse({ filePath: PDF, color: "#fff" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(BackgroundColorInputSchema.safeParse({ filePath: PDF, opacity: 0.5 }).success).toBe(false);
  });
});

describe("ChangeTextColorInputSchema", () => {
  it("defaults color to black", () => {
    expect(ChangeTextColorInputSchema.parse({ filePath: PDF }).color).toBe("#000000");
  });
  it("accepts an explicit hex color", () => {
    expect(ChangeTextColorInputSchema.safeParse({ filePath: PDF, color: "#DC2626" }).success).toBe(true);
  });
  it("rejects a malformed color", () => {
    expect(ChangeTextColorInputSchema.safeParse({ filePath: PDF, color: "red" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(ChangeTextColorInputSchema.safeParse({ filePath: PDF, threshold: 100 }).success).toBe(false);
  });
});

describe("OverlayInputSchema", () => {
  const base = { baseFilePath: PDF, overlayFilePath: "C:\\b.pdf" };
  it("accepts overlay and underlay modes", () => {
    expect(OverlayInputSchema.safeParse({ ...base, mode: "overlay" }).success).toBe(true);
    expect(OverlayInputSchema.safeParse({ ...base, mode: "underlay" }).success).toBe(true);
  });
  it("rejects an unknown mode", () => {
    expect(OverlayInputSchema.safeParse({ ...base, mode: "blend" }).success).toBe(false);
  });
  it("defaults opacity to 1 and scaleToFit to false", () => {
    const v = OverlayInputSchema.parse({ ...base, mode: "overlay" });
    expect(v.opacity).toBe(1);
    expect(v.scaleToFit).toBe(false);
  });
  it("accepts the opacity bounds 0.05 and 1", () => {
    expect(OverlayInputSchema.safeParse({ ...base, mode: "overlay", opacity: 0.05 }).success).toBe(true);
    expect(OverlayInputSchema.safeParse({ ...base, mode: "overlay", opacity: 1 }).success).toBe(true);
  });
  it("rejects opacity outside 0.05..1", () => {
    expect(OverlayInputSchema.safeParse({ ...base, mode: "overlay", opacity: 0.04 }).success).toBe(false);
    expect(OverlayInputSchema.safeParse({ ...base, mode: "overlay", opacity: 1.01 }).success).toBe(false);
  });
  it("requires both file paths", () => {
    expect(OverlayInputSchema.safeParse({ baseFilePath: PDF, mode: "overlay" }).success).toBe(false);
    expect(OverlayInputSchema.safeParse({ overlayFilePath: PDF, mode: "overlay" }).success).toBe(false);
  });
  it("rejects unknown keys via .strict()", () => {
    expect(OverlayInputSchema.safeParse({ ...base, mode: "overlay", blend: true }).success).toBe(false);
  });
});

describe("WorkflowInputSchema", () => {
  it("accepts a single-step workflow", () => {
    expect(
      WorkflowInputSchema.safeParse({
        steps: [{ toolId: "rotate", input: { filePath: PDF, angle: 90 } }],
      }).success
    ).toBe(true);
  });
  it("accepts a multi-step workflow of up to 20 steps", () => {
    const steps = Array.from({ length: 20 }, () => ({
      toolId: "rotate",
      input: { filePath: PDF, angle: 90 },
    }));
    expect(WorkflowInputSchema.safeParse({ steps }).success).toBe(true);
  });
  it("rejects an empty steps array", () => {
    expect(WorkflowInputSchema.safeParse({ steps: [] }).success).toBe(false);
  });
  it("rejects more than 20 steps", () => {
    const steps = Array.from({ length: 21 }, () => ({
      toolId: "rotate",
      input: { filePath: PDF, angle: 90 },
    }));
    expect(WorkflowInputSchema.safeParse({ steps }).success).toBe(false);
  });
  it("rejects a step without an input object", () => {
    expect(WorkflowInputSchema.safeParse({ steps: [{ toolId: "rotate" }] }).success).toBe(false);
  });
  it("rejects unknown step keys via .strict()", () => {
    expect(
      WorkflowInputSchema.safeParse({
        steps: [{ toolId: "rotate", input: {}, label: "x" }],
      }).success
    ).toBe(false);
  });
  it("rejects unknown top-level keys via .strict()", () => {
    expect(WorkflowInputSchema.safeParse({ steps: [], name: "x" }).success).toBe(false);
  });
});
