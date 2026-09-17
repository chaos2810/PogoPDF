import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { pickImages } from "../../app/rpc";
import { useApp } from "../../app/store";
import { FileToolScreen } from "../FileToolScreen";
import { Field, NumberInput, RadioGroup, Select } from "../organize/forms";

// The extensions the engine can decode; the picker accepts the same set.
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "svg"];

type PageSize = "fit" | "a4" | "letter";
type Orientation = "portrait" | "landscape";

export function ImagesToPdfScreen() {
  const { lang } = useApp();
  const [pageSize, setPageSize] = useState<PageSize>("fit");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [margin, setMargin] = useState(0);

  const marginInvalid = !Number.isFinite(margin) || margin < 0 || margin > 72;
  const fixedSize = pageSize !== "fit";

  return (
    <FileToolScreen
      toolId={TOOL_IDS.imagesToPdf}
      acceptMultiple
      ctaKey="tool.imagesToPdf.cta"
      extensions={IMAGE_EXTENSIONS}
      pick={() => pickImages(true)}
      dropKeys={{
        multiple: "tool.imagesToPdf.drop",
        single: "tool.imagesToPdf.dropSingle",
      }}
      validationError={() => (marginInvalid ? "tool.imagesToPdf.marginInvalid" : null)}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePaths: files, pageSize, margin };
        // The schema rejects orientation with pageSize="fit", so only send it
        // when the radios are actually meaningful.
        if (fixedSize) input.orientation = orientation;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.imagesToPdf.pageSize">
            <Select
              testId="imagestopdf-pagesize"
              value={pageSize}
              onChange={(v) => setPageSize(v as PageSize)}
              options={[
                { value: "fit", label: t("tool.imagesToPdf.pageSizeFit", lang) },
                { value: "a4", label: t("tool.imagesToPdf.pageSizeA4", lang) },
                { value: "letter", label: t("tool.imagesToPdf.pageSizeLetter", lang) },
              ]}
            />
          </Field>
          <Field labelKey="tool.imagesToPdf.orientation">
            <RadioGroup
              name="imagestopdf-orientation"
              value={orientation}
              onChange={(v) => setOrientation(v as Orientation)}
              disabled={!fixedSize}
              choices={[
                { value: "portrait", labelKey: "tool.imagesToPdf.portrait" },
                { value: "landscape", labelKey: "tool.imagesToPdf.landscape" },
              ]}
            />
          </Field>
          <Field labelKey="tool.imagesToPdf.margin" hintKey="tool.imagesToPdf.marginHint">
            <NumberInput
              testId="imagestopdf-margin"
              value={margin}
              onChange={setMargin}
              min={0}
              max={72}
              invalid={marginInvalid}
            />
          </Field>
        </>
      }
    />
  );
}
