import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { ANNOTATION_TYPES } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickPdfs } from "../../app/rpc";
import { SaveAsBar } from "../../components/SaveAsBar";
import { usePdfJob } from "../usePdfJob";
import { Checkbox, Hint } from "../organize/forms";
import { ToolFrame } from "../ToolFrame";

// The editor's own labels already name every model annotation type; reuse them
// rather than duplicating the same vocabulary.
const TYPE_LABEL_KEY: Record<(typeof ANNOTATION_TYPES)[number], string> = {
  text: "tool.editor.toolText",
  highlight: "tool.editor.toolHighlight",
  underline: "tool.editor.toolUnderline",
  strikeout: "tool.editor.toolStrikeout",
  rect: "tool.editor.toolRect",
  ellipse: "tool.editor.toolEllipse",
  line: "tool.editor.toolLine",
  arrow: "tool.editor.toolArrow",
  freehand: "tool.editor.toolFreehand",
  redact: "tool.editor.toolRedact",
  image: "tool.editor.toolImage",
  freetext: "tool.editor.toolFreetext",
};

// Removal semantics are deliberately explicit: the engine treats an empty or
// omitted list as "remove everything", so the UI never sends an empty list from
// an accidental no-selection. Zero checked disables the CTA; the All types
// toggle is the only path that asks for remove-all (it omits the types key).
export function RemoveAnnotationsScreen() {
  const { lang } = useApp();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [allTypes, setAllTypes] = useState(false);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const toggle = (type: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const job = usePdfJob(TOOL_IDS.removeAnnotations, (fs) => {
    const input: Record<string, unknown> = { filePath: fs[0] };
    // All types omits `types`, which the engine reads as remove-all.
    if (!allTypes) input.types = [...checked];
    return input;
  });
  const { files, setFiles, reset, run } = job;

  const noSelection = !allTypes && checked.size === 0;
  const validationKey = files.length > 0 && noSelection ? "tool.removeAnnotations.pickOne" : null;

  const start = () =>
    void run((result) => {
      if (!("outputPath" in result)) throw new Error("Expected a file result");
      setOutputPath(result.outputPath as string);
      return "done";
    });

  const handleReset = () => {
    setOutputPath(null);
    setChecked(new Set());
    setAllTypes(false);
    reset();
  };

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    setFiles([picked[0]]);
  };

  return (
    <ToolFrame
      toolId={TOOL_IDS.removeAnnotations}
      job={job}
      ctaKey="tool.removeAnnotations.cta"
      canRun={files.length >= 1 && (allTypes || checked.size > 0)}
      validationKey={validationKey}
      onPick={() => void pick()}
      onRun={start}
      pickContent={
        <div data-testid="removeannotations-types" style={{ marginTop: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {t("tool.removeAnnotations.typesLabel", lang)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0 20px" }}>
            {ANNOTATION_TYPES.map((type) => (
              <Checkbox
                key={type}
                testId={`removeannotations-type-${type}`}
                checked={allTypes || checked.has(type)}
                disabled={allTypes}
                onChange={() => toggle(type)}
                labelKey={TYPE_LABEL_KEY[type]}
              />
            ))}
          </div>
          <Checkbox
            testId="removeannotations-all"
            checked={allTypes}
            onChange={(v) => setAllTypes(v)}
            labelKey="tool.removeAnnotations.allTypes"
          />
          <Hint keyName="tool.removeAnnotations.lineArrowNote" stacked />
          <Hint keyName="tool.removeAnnotations.modelOnlyNote" stacked />
          <Hint keyName="tool.removeAnnotations.hint" stacked />
        </div>
      }
      renderDone={() =>
        outputPath ? <SaveAsBar outputPath={outputPath} onReset={handleReset} /> : null
      }
    />
  );
}
