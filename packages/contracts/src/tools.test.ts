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

describe("TOOL_IDS", () => {
  it("contains all 40 tools with values equal to their keys", () => {
    for (const [key, value] of Object.entries(TOOL_IDS)) {
      expect(value).toBe(key);
    }
    expect(Object.keys(TOOL_IDS)).toHaveLength(40);
  });
});
