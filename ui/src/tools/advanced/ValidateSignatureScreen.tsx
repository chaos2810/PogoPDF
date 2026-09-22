import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import type { SignatureData } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickPdfs } from "../../app/rpc";
import { usePdfJob } from "../usePdfJob";
import { ToolFrame } from "../ToolFrame";

/**
 * Validating a signature needs no options, so the job runs as soon as a file is
 * picked (the brief's "run on file select"): the screen re-runs whenever the
 * picked file changes and renders the StructuralSignature result as a card.
 */
export function ValidateSignatureScreen() {
  const { lang } = useApp();
  const job = usePdfJob(
    TOOL_IDS.validateSignature,
    (files) => ({ filePath: files[0] }),
    { multiple: false }
  );
  const { files, setFiles, run, setData } = job;
  // Track the file a run was started for so a re-render (not a new pick) does
  // not re-fire; reset() clears it via the file list going empty.
  const ranFor = useRef<string | null>(null);

  const start = () =>
    void run((result) => {
      if (!("data" in result)) throw new Error("Expected a data result");
      setData(result.data);
      return "data";
    });

  // Run as soon as a file is picked; `ranFor` guards against re-firing when the
  // component re-renders for an unrelated reason (the file identity is the key).
  useEffect(() => {
    const filePath = files[0];
    if (!filePath) {
      ranFor.current = null;
      return;
    }
    if (ranFor.current === filePath) return;
    ranFor.current = filePath;
    start();
    // start/run are recreated per render, so the guard, not the identity, is
    // what keeps this effect from re-running the job.
  }, [files]);

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    setFiles([picked[0]]);
  };

  const renderData = (data: unknown): ReactNode => {
    const d = data as SignatureData;
    if (!d.signer) {
      return (
        <div data-testid="validateSignature-nosig" style={{ color: "var(--muted)", fontSize: 14 }}>
          {t("tool.validateSignature.noSignature", lang)}
        </div>
      );
    }
    const rows: [string, string][] = [
      [
        "tool.validateSignature.labelValid",
        t(d.valid ? "tool.validateSignature.valid" : "tool.validateSignature.invalid", lang),
      ],
      ["tool.validateSignature.labelSigner", d.signer.subject],
      ["tool.validateSignature.labelIssuer", d.signer.issuer],
      ["tool.validateSignature.labelSerial", d.signer.serial],
      ["tool.validateSignature.labelNotAfter", d.signer.notAfter],
      ["tool.validateSignature.labelCertificates", String(d.certificates)],
    ];
    return (
      <dl data-testid="data-rows" style={{ margin: 0 }}>
        {rows.map(([labelKey, value]) => (
          <div
            key={labelKey}
            data-testid="data-row"
            style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}
          >
            <dt style={{ flex: "0 0 160px", color: "var(--muted)", fontWeight: 600, fontSize: 13 }}>
              {t(labelKey, lang)}
            </dt>
            <dd style={{ margin: 0, minWidth: 0, flex: 1, overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    );
  };

  return (
    <ToolFrame
      toolId={TOOL_IDS.validateSignature}
      job={job}
      ctaKey="tool.validateSignature.cta"
      canRun={false}
      // No options, so the job runs on file select; there is no CTA to press.
      hideCta
      onPick={() => void pick()}
      onRun={start}
      footnoteKey="tool.validateSignature.revocationHint"
      renderData={renderData}
    />
  );
}
