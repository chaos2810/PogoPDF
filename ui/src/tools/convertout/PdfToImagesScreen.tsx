import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput, Select, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

// Format identifiers are technical values, not UI prose: they stay literal in
// both languages (like the "1-3,5" page-spec placeholder).
const FORMATS = [
  { value: "jpg", label: "JPG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
  { value: "bmp", label: "BMP" },
  { value: "tiff", label: "TIFF" },
];

export function PdfToImagesScreen() {
  const [format, setFormat] = useState("jpg");
  const [dpi, setDpi] = useState(150);
  const [pages, setPages] = useState("");
  const [quality, setQuality] = useState(80);

  const dpiInvalid = !Number.isFinite(dpi) || dpi < 72 || dpi > 600;
  const qualityInvalid = !Number.isFinite(quality) || quality < 1 || quality > 100;
  const lossy = format === "jpg" || format === "webp";

  const error =
    dpiInvalid
      ? "tool.pdfToImages.dpiInvalid"
      : lossy && qualityInvalid
        ? "tool.pdfToImages.qualityInvalid"
        : validateOptionalPageSpec(pages);

  return (
    <FileToolScreen
      toolId={TOOL_IDS.pdfToImages}
      acceptMultiple={false}
      ctaKey="tool.pdfToImages.cta"
      validationError={() => error}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0], format, dpi };
        if (lossy) input.quality = quality;
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.pdfToImages.format">
            <Select
              testId="pdftoimages-format"
              value={format}
              onChange={setFormat}
              options={FORMATS}
            />
          </Field>
          <Field labelKey="tool.pdfToImages.dpi">
            <NumberInput
              testId="pdftoimages-dpi"
              value={dpi}
              onChange={setDpi}
              min={72}
              max={600}
              invalid={dpiInvalid}
            />
          </Field>
          {lossy && (
            <Field labelKey="tool.pdfToImages.quality">
              <NumberInput
                testId="pdftoimages-quality"
                value={quality}
                onChange={setQuality}
                min={1}
                max={100}
                invalid={qualityInvalid}
              />
            </Field>
          )}
          {lossy && <Hint keyName="tool.pdfToImages.qualityHint" />}
          <Field labelKey="tool.pdfToImages.pages">
            <TextInput
              testId="pdftoimages-pages"
              value={pages}
              onChange={setPages}
              placeholder="1-3,5"
            />
          </Field>
          <Hint keyName="tool.pdfToImages.pagesHint" />
        </>
      }
    />
  );
}
