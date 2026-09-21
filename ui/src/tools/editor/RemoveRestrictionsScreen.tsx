import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { pickPdfs } from "../../app/rpc";
import { SaveAsBar } from "../../components/SaveAsBar";
import { usePdfJob } from "../usePdfJob";
import { Field, Hint, PasswordInput } from "../organize/forms";
import { ToolFrame } from "../ToolFrame";

export function RemoveRestrictionsScreen() {
  const [password, setPassword] = useState("");
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const job = usePdfJob(TOOL_IDS.removeRestrictions, (fs) => {
    const input: Record<string, unknown> = { filePath: fs[0] };
    // An empty box must omit the key: the schema makes `password` optional, and
    // the engine uses "absent" to mean "try without one".
    if (password.length > 0) input.password = password;
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
    setPassword("");
    reset();
  };

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    setFiles([picked[0]]);
  };

  return (
    <ToolFrame
      toolId={TOOL_IDS.removeRestrictions}
      job={job}
      ctaKey="tool.removeRestrictions.cta"
      canRun={files.length >= 1}
      onPick={() => void pick()}
      onRun={start}
      pickContent={
        <>
          <Field labelKey="tool.removeRestrictions.password" hintKey="tool.removeRestrictions.passwordHint">
            <PasswordInput
              testId="removerestrictions-password"
              value={password}
              onChange={setPassword}
            />
          </Field>
          <Hint keyName="tool.removeRestrictions.note" stacked />
        </>
      }
      renderDone={() =>
        outputPath ? <SaveAsBar outputPath={outputPath} onReset={handleReset} /> : null
      }
    />
  );
}
