import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { pickImages } from "../../app/rpc";
import { useApp } from "../../app/store";
import { FileToolScreen } from "../FileToolScreen";
import {
  Field,
  Hint,
  NumberInput,
  RadioGroup,
  TextInput,
} from "../organize/forms";
import { basename } from "../paths";
import { validateOptionalPageSpec } from "../pagespec";

type Mode = "text" | "image";
type Position = "center" | "tile";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function WatermarkScreen() {
  const { lang } = useApp();
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(48);
  const [rotation, setRotation] = useState(45);
  const [color, setColor] = useState("#808080");
  const [position, setPosition] = useState<Position>("center");
  const [imagePath, setImagePath] = useState("");
  const [opacity, setOpacity] = useState(0.15);
  const [pages, setPages] = useState("");

  const fontSizeInvalid = !Number.isInteger(fontSize) || fontSize < 6 || fontSize > 200;
  const rotationInvalid = !Number.isFinite(rotation) || rotation < -360 || rotation > 360;
  const opacityInvalid = !Number.isFinite(opacity) || opacity < 0.05 || opacity > 1;
  const colorInvalid = !HEX_RE.test(color);

  const error =
    mode === "text" && text.trim().length === 0
      ? "tool.watermark.textRequired"
      : mode === "image" && imagePath.length === 0
        ? "tool.watermark.imageRequired"
        : opacityInvalid
          ? "tool.watermark.opacityInvalid"
          : mode === "text" && fontSizeInvalid
            ? "tool.watermark.fontSizeInvalid"
            : mode === "text" && rotationInvalid
              ? "tool.watermark.rotationInvalid"
              : mode === "text" && colorInvalid
                ? "tool.watermark.colorInvalid"
                : validateOptionalPageSpec(pages);

  const pickImage = async () => {
    const picked = await pickImages(false);
    if (picked.length > 0) setImagePath(picked[0]);
  };

  return (
    <FileToolScreen
      toolId={TOOL_IDS.watermark}
      acceptMultiple={false}
      ctaKey="tool.watermark.cta"
      validationError={() => error}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0], opacity };
        if (mode === "text") {
          input.text = text;
          input.fontSize = fontSize;
          input.rotation = rotation;
          input.color = color;
          input.position = position;
        } else {
          // Image mode v1 is always centered; the schema rejects tile.
          input.imagePath = imagePath;
          input.position = "center";
        }
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.watermark.mode">
            <RadioGroup
              name="watermark-mode"
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              choices={[
                { value: "text", labelKey: "tool.watermark.modeText" },
                { value: "image", labelKey: "tool.watermark.modeImage" },
              ]}
            />
          </Field>

          {mode === "text" ? (
            <>
              <Field labelKey="tool.watermark.text" hintKey="tool.watermark.latinHint">
                <TextInput testId="watermark-text" value={text} onChange={setText} />
              </Field>
              <Field labelKey="tool.watermark.fontSize">
                <NumberInput
                  testId="watermark-fontsize"
                  value={fontSize}
                  onChange={setFontSize}
                  min={6}
                  max={200}
                  invalid={fontSizeInvalid}
                />
              </Field>
              <Field labelKey="tool.watermark.rotation">
                <NumberInput
                  testId="watermark-rotation"
                  value={rotation}
                  onChange={setRotation}
                  min={-360}
                  max={360}
                  invalid={rotationInvalid}
                />
              </Field>
              <Field labelKey="tool.watermark.color">
                <TextInput
                  testId="watermark-color"
                  value={color}
                  onChange={setColor}
                  placeholder="#808080"
                  style={{ borderColor: colorInvalid ? "var(--danger)" : "var(--border)" }}
                />
              </Field>
              <Field labelKey="tool.watermark.position">
                <RadioGroup
                  name="watermark-position"
                  value={position}
                  onChange={(v) => setPosition(v as Position)}
                  choices={[
                    { value: "center", labelKey: "tool.watermark.positionCenter" },
                    { value: "tile", labelKey: "tool.watermark.positionTile" },
                  ]}
                />
              </Field>
            </>
          ) : (
            // Not a Field: a <button> inside the Field label is labelable and
            // would receive the label's forwarded click twice.
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                {t("tool.watermark.image", lang)}
              </span>
              <button
                data-testid="watermark-pick-image"
                onClick={() => void pickImage()}
                style={{
                  padding: "8px 14px", borderRadius: "var(--radius-pill)",
                  fontWeight: 600, background: "transparent",
                  border: "1px solid var(--border)", color: "var(--text)", cursor: "pointer",
                  maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {imagePath ? basename(imagePath) : t("tool.watermark.pickImage", lang)}
              </button>
            </div>
          )}

          <Field labelKey="tool.watermark.opacity" hintKey="tool.watermark.opacityHint">
            <NumberInput
              testId="watermark-opacity"
              value={opacity}
              onChange={setOpacity}
              min={0.05}
              max={1}
              step={0.05}
              invalid={opacityInvalid}
            />
          </Field>
          <Field labelKey="tool.watermark.pages">
            <TextInput
              testId="watermark-pages"
              value={pages}
              onChange={setPages}
              placeholder="1-3,5"
            />
          </Field>
          {mode === "image" && <Hint keyName="tool.watermark.imageHint" stacked />}
        </>
      }
    />
  );
}
