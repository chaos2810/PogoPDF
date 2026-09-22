import { useState } from "react";
import { X } from "lucide-react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickPdfs } from "../../app/rpc";
import { FileToolScreen } from "../FileToolScreen";
import { Checkbox, Field, Hint, NumberInput, RadioGroup } from "../organize/forms";
import { basename } from "../paths";

type Mode = "overlay" | "underlay";

// The base PDF arrives through the standard drop zone; the overlay file is a
// second PDF picked separately, since the schema takes two distinct paths.
export function OverlayScreen() {
  const { lang } = useApp();
  const [overlayPath, setOverlayPath] = useState("");
  const [mode, setMode] = useState<Mode>("overlay");
  const [opacity, setOpacity] = useState(1);
  const [scaleToFit, setScaleToFit] = useState(false);

  const opacityInvalid = !Number.isFinite(opacity) || opacity < 0.05 || opacity > 1;

  const error = overlayPath.length === 0
    ? "tool.overlay.overlayRequired"
    : opacityInvalid
      ? "tool.overlay.opacityInvalid"
      : null;

  const pickOverlay = async () => {
    const picked = await pickPdfs(false);
    if (picked.length > 0) setOverlayPath(picked[0]);
  };

  return (
    <FileToolScreen
      toolId={TOOL_IDS.overlay}
      acceptMultiple={false}
      ctaKey="tool.overlay.cta"
      validationError={() => error}
      buildInput={(files) => ({
        baseFilePath: files[0],
        overlayFilePath: overlayPath,
        mode,
        opacity,
        scaleToFit,
      })}
      dropKeys={{
        multiple: "tool.overlay.baseDrop",
        single: "tool.overlay.baseDrop",
      }}
      options={
        <>
          <div style={{ gridColumn: "1 / -1" }} data-testid="overlay-second">
            <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {t("tool.overlay.overlayLabel", lang)}
            </span>
            <button
              data-testid="overlay-pick"
              onClick={() => void pickOverlay()}
              style={{
                padding: "8px 16px", borderRadius: "var(--radius-pill)", fontWeight: 600,
                background: "transparent", border: "1px solid var(--border)",
                color: "var(--text)", cursor: "pointer",
              }}
            >
              {t("tool.overlay.addOverlay", lang)}
            </button>
            {overlayPath && (
              <ul data-testid="data-rows" style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
                <li
                  data-testid="data-row"
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "6px 0", borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span
                    title={overlayPath}
                    style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}
                  >
                    {basename(overlayPath)}
                  </span>
                  <button
                    data-testid="overlay-remove"
                    aria-label={`${t("tool.common.remove", lang)}: ${basename(overlayPath)}`}
                    onClick={() => setOverlayPath("")}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      border: "none", background: "transparent", color: "var(--danger)",
                      cursor: "pointer", padding: 4,
                    }}
                  >
                    <X size={14} />
                  </button>
                </li>
              </ul>
            )}
          </div>

          <Field labelKey="tool.overlay.mode">
            <RadioGroup
              name="overlay-mode"
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              choices={[
                { value: "overlay", labelKey: "tool.overlay.modeOverlay" },
                { value: "underlay", labelKey: "tool.overlay.modeUnderlay" },
              ]}
            />
          </Field>
          <Field labelKey="tool.overlay.opacity" hintKey="tool.overlay.opacityHint">
            <NumberInput
              testId="overlay-opacity"
              value={opacity}
              onChange={setOpacity}
              min={0.05}
              max={1}
              step={0.05}
              invalid={opacityInvalid}
            />
          </Field>
          <Checkbox
            testId="overlay-scaletofit"
            checked={scaleToFit}
            onChange={setScaleToFit}
            labelKey="tool.overlay.scaleToFit"
          />
          <div style={{ gridColumn: "1 / -1" }}>
            <Hint keyName="tool.overlay.hint" stacked />
          </div>
        </>
      }
    />
  );
}
