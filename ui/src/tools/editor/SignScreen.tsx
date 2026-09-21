import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickImages, pickPdfs } from "../../app/rpc";
import { SaveAsBar } from "../../components/SaveAsBar";
import { usePdfJob } from "../usePdfJob";
import { Field, Hint, NumberInput, RadioGroup, TextInput } from "../organize/forms";
import { basename } from "../paths";
import { ToolFrame } from "../ToolFrame";

type Mode = "draw" | "type" | "image";
type InkPoint = { x: number; y: number };

const PAD_W = 360;
const PAD_H = 160;

/** Pointer-captured signature pad: records 0..1 normalized ink points. */
function SignaturePad({
  points,
  onAdd,
  onClear,
}: {
  points: InkPoint[];
  onAdd: (point: InkPoint) => void;
  onClear: () => void;
}) {
  const { lang } = useApp();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const append = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onAdd({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
  };

  return (
    <div>
      <div style={{ position: "relative", width: PAD_W, maxWidth: "100%", height: PAD_H }}>
        <canvas
          ref={ref}
          data-testid="sign-pad"
          width={PAD_W}
          height={PAD_H}
          onPointerDown={(e) => {
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            append(e);
          }}
          onPointerMove={(e) => {
            if (drawing.current) append(e);
          }}
          onPointerUp={(e) => {
            drawing.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={(e) => {
            drawing.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            touchAction: "none", borderRadius: 8, border: "1px solid var(--border)",
            background: "#FFFFFF", cursor: "crosshair", display: "block",
          }}
        />
        {/* Stroke preview drawn as an SVG overlay: crisp and resolution independent. */}
        <svg
          viewBox={`0 0 ${PAD_W} ${PAD_H}`}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          <polyline
            points={points.map((p) => `${p.x * PAD_W},${p.y * PAD_H}`).join(" ")}
            fill="none"
            stroke="#1a1a1a"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{t("tool.sign.padHint", lang)}</span>
        <button
          data-testid="sign-clear"
          onClick={onClear}
          style={{
            padding: "6px 14px", borderRadius: "var(--radius-pill)", fontWeight: 600,
            background: "transparent", border: "1px solid var(--border)",
            color: "var(--text)", cursor: "pointer",
          }}
        >
          {t("tool.sign.clear", lang)}
        </button>
      </div>
    </div>
  );
}

// Default placement differs per mode because x/y means different things:
// draw maps normalized ink onto the full page box then translates by (x, y), so
// 0,0 keeps it on the page; type anchors a baseline and image a top-left corner,
// so both want an inset anchor that is visibly on the page.
const PLACEMENT: Record<Mode, { x: number; y: number }> = {
  draw: { x: 0, y: 0 },
  type: { x: 72, y: 640 },
  image: { x: 72, y: 72 },
};

export function SignScreen() {
  const { lang } = useApp();
  const [mode, setMode] = useState<Mode>("draw");
  const [inkPoints, setInkPoints] = useState<InkPoint[]>([]);
  const [text, setText] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [page, setPage] = useState(1);
  const [x, setX] = useState(PLACEMENT.draw.x);
  const [y, setY] = useState(PLACEMENT.draw.y);
  const [scale, setScale] = useState(1);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  // Switching mode resets x/y to that mode's sensible default (the same numbers
  // mean different things per mode).
  const changeMode = (next: Mode) => {
    setMode(next);
    setX(PLACEMENT[next].x);
    setY(PLACEMENT[next].y);
  };

  const scaleInvalid = !Number.isFinite(scale) || scale < 0.1 || scale > 4;
  const pageInvalid = !Number.isInteger(page) || page < 1;

  const error =
    mode === "draw" && inkPoints.length < 2
      ? "tool.sign.textRequired"
      : mode === "type" && text.trim().length === 0
        ? "tool.sign.textRequired"
        : mode === "image" && imagePath.length === 0
          ? "tool.sign.imageRequired"
          : scaleInvalid
            ? "tool.sign.scaleInvalid"
            : pageInvalid
              ? "tool.common.pageInvalid"
              : null;

  const job = usePdfJob(TOOL_IDS.sign, (fs) => {
    const input: Record<string, unknown> = { filePath: fs[0], mode, page, x, y, scale };
    if (mode === "draw") input.inkPoints = inkPoints;
    if (mode === "type") input.text = text;
    if (mode === "image") input.imageFile = imagePath;
    return input;
  });
  const { files, setFiles, reset, run } = job;

  const start = () =>
    void run((result) => {
      if (!("outputPath" in result)) throw new Error("Expected a file result");
      setOutputPath(result.outputPath as string);
      return "done";
    });

  const handleReset = () => {
    setOutputPath(null);
    reset();
  };

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    setFiles([picked[0]]);
  };

  const pickImage = async () => {
    const picked = await pickImages(false);
    if (picked.length > 0) setImagePath(picked[0]);
  };

  return (
    <ToolFrame
      toolId={TOOL_IDS.sign}
      job={job}
      ctaKey="tool.sign.cta"
      canRun={files.length >= 1 && !error}
      validationKey={files.length > 0 ? error : null}
      onPick={() => void pick()}
      onRun={start}
      pickContent={
        <>
          <Field labelKey="tool.sign.mode">
            <RadioGroup
              name="sign-mode"
              value={mode}
              onChange={(v) => changeMode(v as Mode)}
              choices={[
                { value: "draw", labelKey: "tool.sign.modeDraw" },
                { value: "type", labelKey: "tool.sign.modeType" },
                { value: "image", labelKey: "tool.sign.modeImage" },
              ]}
            />
          </Field>

          {mode === "draw" && (
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                {t("tool.sign.pad", lang)}
              </span>
              <SignaturePad
                points={inkPoints}
                onAdd={(p) => setInkPoints((prev) => [...prev, p])}
                onClear={() => setInkPoints([])}
              />
            </div>
          )}

          {mode === "type" && (
            <Field labelKey="tool.sign.text" hintKey="tool.sign.latinHint">
              <TextInput testId="sign-text" value={text} onChange={setText} />
            </Field>
          )}

          {mode === "image" && (
            // Not a Field: a <button> inside a label would receive the click twice.
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                {t("tool.sign.image", lang)}
              </span>
              <button
                data-testid="sign-pick-image"
                onClick={() => void pickImage()}
                style={{
                  padding: "8px 14px", borderRadius: "var(--radius-pill)", fontWeight: 600,
                  background: "transparent", border: "1px solid var(--border)",
                  color: "var(--text)", cursor: "pointer", maxWidth: "100%",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {imagePath ? basename(imagePath) : t("tool.sign.pickImage", lang)}
              </button>
            </div>
          )}

          <Field labelKey="tool.sign.page">
            <NumberInput
              testId="sign-page"
              value={page}
              onChange={setPage}
              min={1}
              invalid={pageInvalid}
            />
          </Field>
          <Field labelKey="tool.sign.x" hintKey="tool.sign.placementHint">
            <NumberInput testId="sign-x" value={x} onChange={setX} />
          </Field>
          <Field labelKey="tool.sign.y">
            <NumberInput testId="sign-y" value={y} onChange={setY} />
          </Field>
          <Field labelKey="tool.sign.scale">
            <NumberInput
              testId="sign-scale"
              value={scale}
              onChange={setScale}
              min={0.1}
              max={4}
              step={0.1}
              invalid={scaleInvalid}
            />
          </Field>
        </>
      }
      renderDone={() =>
        outputPath ? <SaveAsBar outputPath={outputPath} onReset={handleReset} /> : null
      }
    />
  );
}
