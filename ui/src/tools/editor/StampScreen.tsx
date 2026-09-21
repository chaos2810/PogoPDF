import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { pickPdfs } from "../../app/rpc";
import { SaveAsBar } from "../../components/SaveAsBar";
import { usePdfJob } from "../usePdfJob";
import { Field, NumberInput, TextInput } from "../organize/forms";
import { ToolFrame } from "../ToolFrame";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function StampScreen() {
  const [text, setText] = useState("");
  const [page, setPage] = useState(1);
  const [x, setX] = useState(72);
  const [y, setY] = useState(600);
  const [color, setColor] = useState("#DC2626");
  const [rotate, setRotate] = useState(0);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const colorInvalid = !HEX_RE.test(color);
  const rotateInvalid = !Number.isFinite(rotate) || rotate < -360 || rotate > 360;
  const pageInvalid = !Number.isInteger(page) || page < 1;

  const error =
    text.trim().length === 0
      ? "tool.stamp.textRequired"
      : colorInvalid
        ? "tool.stamp.colorInvalid"
          : rotateInvalid
            ? "tool.stamp.rotateInvalid"
            : pageInvalid
              ? "tool.common.pageInvalid"
              : null;

  const job = usePdfJob(TOOL_IDS.stamp, (fs) => ({
    filePath: fs[0], text, page, x, y, color, rotate,
  }));
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

  return (
    <ToolFrame
      toolId={TOOL_IDS.stamp}
      job={job}
      ctaKey="tool.stamp.cta"
      canRun={files.length >= 1}
      validationKey={error}
      onPick={() => void pick()}
      onRun={start}
      pickContent={
        <>
          <Field labelKey="tool.stamp.text" hintKey="tool.stamp.latinHint" >
            <TextInput testId="stamp-text" value={text} onChange={setText} />
          </Field>
          <Field labelKey="tool.stamp.page">
            <NumberInput testId="stamp-page" value={page} onChange={setPage} min={1} invalid={pageInvalid} />
          </Field>
          <Field labelKey="tool.stamp.x" hintKey="tool.stamp.placementHint">
            <NumberInput testId="stamp-x" value={x} onChange={setX} />
          </Field>
          <Field labelKey="tool.stamp.y">
            <NumberInput testId="stamp-y" value={y} onChange={setY} />
          </Field>
          <Field labelKey="tool.stamp.color">
            <TextInput
              testId="stamp-color"
              value={color}
              onChange={setColor}
              placeholder="#DC2626"
              style={{ borderColor: colorInvalid ? "var(--danger)" : "var(--border)" }}
            />
          </Field>
          <Field labelKey="tool.stamp.rotate">
            <NumberInput
              testId="stamp-rotate"
              value={rotate}
              onChange={setRotate}
              min={-360}
              max={360}
              invalid={rotateInvalid}
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
