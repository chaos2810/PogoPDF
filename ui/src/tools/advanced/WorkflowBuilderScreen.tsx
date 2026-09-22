import { useState } from "react";
import { X } from "lucide-react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, Select } from "../organize/forms";
import { registry } from "../registry";

/**
 * The v1 workflow editor is a step list, not a canvas: each row picks a tool and
 * carries that step's input as JSON. The engine's threading contract is v1
 * (filePath/baseFilePath may be "$previous"); the UI adds one convenience token,
 * "$file", which it substitutes with the file picked in the drop zone so the
 * first step has a source. Nested workflows cannot be a step, so the workflow
 * tool itself is excluded from the picker.
 */
const STEP_TOOLS = registry
  .filter((entry) => entry.id !== TOOL_IDS.workflow && entry.id !== TOOL_IDS.editorSave)
  .map((entry) => ({ value: entry.id, labelKey: entry.titleKey }));

const DEFAULT_TOOL = TOOL_IDS.rotate;
const FIRST_STEP_INPUT = '{\n  "filePath": "$file",\n  "angle": 90\n}';

type Step = { toolId: string; input: string };

function parseStepInput(input: string): Record<string, unknown> | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Replace the UI "$file" token with the picked path, everywhere it appears. */
function substituteFile(value: unknown, filePath: string): unknown {
  if (value === "$file") return filePath;
  if (Array.isArray(value)) return value.map((v) => substituteFile(v, filePath));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substituteFile(v, filePath)])
    );
  }
  return value;
}

export function WorkflowBuilderScreen() {
  const { lang } = useApp();
  const [steps, setSteps] = useState<Step[]>([
    { toolId: DEFAULT_TOOL, input: FIRST_STEP_INPUT },
  ]);

  const parsed = steps.map((s) => parseStepInput(s.input));
  const stepsValid =
    steps.length > 0 && steps.every((s) => s.toolId.length > 0) && parsed.every((p) => p !== null);

  const setStep = (index: number, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const addStep = () => setSteps((prev) => [...prev, { toolId: TOOL_IDS.rotate, input: "{}" }]);
  const removeStep = (index: number) =>
    setSteps((prev) => prev.filter((_, i) => i !== index));

  return (
    <FileToolScreen
      toolId={TOOL_IDS.workflow}
      acceptMultiple={false}
      ctaKey="tool.workflow.cta"
      validationError={() =>
        steps.length === 0
          ? "tool.workflow.emptyHint"
          : stepsValid
            ? null
            : "tool.workflow.inputInvalid"
      }
      canRun={(files) => files.length >= 1 && stepsValid}
      buildInput={(files) => ({
        steps: steps.map((s, i) => {
          const input = parsed[i] ?? {};
          return { toolId: s.toolId, input: substituteFile(input, files[0]) };
        }),
      })}
      options={
        <div style={{ gridColumn: "1 / -1" }} data-testid="workflow-steps">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            {t("tool.workflow.stepsLabel", lang)}
          </div>
          {steps.map((step, i) => (
            <div
              key={i}
              data-testid={`workflow-step-${i}`}
              style={{
                border: "1px solid var(--border)", borderRadius: "var(--radius-tile)",
                padding: 10, marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                  {t("tool.workflow.step", lang, { n: String(i + 1) })}
                </span>
                <button
                  data-testid={`workflow-remove-${i}`}
                  aria-label={t("tool.workflow.removeStep", lang)}
                  onClick={() => removeStep(i)}
                  style={{
                    marginLeft: "auto", display: "inline-flex", alignItems: "center",
                    justifyContent: "center", border: "none", background: "transparent",
                    color: "var(--danger)", cursor: "pointer", padding: 2,
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <Field labelKey="tool.workflow.toolField">
                <Select
                  testId={`workflow-tool-${i}`}
                  value={step.toolId}
                  onChange={(v) => setStep(i, { toolId: v })}
                  options={STEP_TOOLS.map((o) => ({ value: o.value, label: t(o.labelKey, lang) }))}
                />
              </Field>
              <Field labelKey="tool.workflow.inputField">
                <textarea
                  data-testid={`workflow-input-${i}`}
                  value={step.input}
                  onChange={(e) => setStep(i, { input: e.target.value })}
                  spellCheck={false}
                  style={{
                    width: "100%", minHeight: 84, padding: "8px 10px", borderRadius: 8,
                    border: `1px solid ${parsed[i] === null ? "var(--danger)" : "var(--border)"}`,
                    background: "var(--bg)", color: "var(--text)",
                    fontFamily: "ui-monospace, monospace", fontSize: 12, resize: "vertical",
                  }}
                />
              </Field>
            </div>
          ))}
          <button
            data-testid="workflow-add"
            onClick={addStep}
            style={{
              padding: "8px 16px", borderRadius: "var(--radius-pill)", fontWeight: 600,
              background: "transparent", border: "1px solid var(--border)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            {t("tool.workflow.addStep", lang)}
          </button>
          <Hint keyName="tool.workflow.threadingHint" stacked />
          <Hint keyName="tool.workflow.nestedHint" />
          <Hint keyName="tool.workflow.noFileHint" />
        </div>
      }
    />
  );
}
