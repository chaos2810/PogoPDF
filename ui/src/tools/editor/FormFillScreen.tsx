import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import type { FormFieldsData } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickPdfs, startJob } from "../../app/rpc";
import { SaveAsBar } from "../../components/SaveAsBar";
import { usePdfJob } from "../usePdfJob";
import { Hint } from "../organize/forms";
import { ToolFrame } from "../ToolFrame";

type FormField = FormFieldsData["fields"][number];

const inputStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 14,
} as const;

/** Label-wrapped control whose text is the field's own name (not an i18n key). */
function FieldLabel({ field, children }: { field: FormField; children: ReactNode }) {
  const { lang } = useApp();
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {field.name}
        {field.required && (
          <span style={{ color: "var(--danger)", marginLeft: 6, fontWeight: 400 }}>
            {t("tool.formFill.required", lang)}
          </span>
        )}
        {field.readOnly && (
          <span style={{ color: "var(--muted)", marginLeft: 6, fontWeight: 400 }}>
            {t("tool.formFill.readOnly", lang)}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

export function FormFillScreen() {
  const { lang } = useApp();
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const job = usePdfJob(TOOL_IDS.formFill, (fs) => ({
    filePath: fs[0],
    values: fields
      .filter((f) => !f.readOnly && f.type !== "signature")
      .map((f) => ({ name: f.name, value: values[f.name] ?? "" })),
  }));
  const { files, setFiles, reset, run } = job;

  useEffect(() => {
    const filePath = files[0];
    if (!filePath) {
      setFields([]);
      setValues({});
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const result = await startJob(TOOL_IDS.formFields, { filePath });
        if (!alive) return;
        const loaded = "data" in result ? (result.data as FormFieldsData).fields ?? [] : [];
        setFields(loaded);
        // Seed text/dropdown/radio controls with the field's current value;
        // checkboxes start unchecked unless the file already checked them.
        const seeded: Record<string, string> = {};
        for (const f of loaded) {
          if (f.type === "checkbox") seeded[f.name] = f.value === "true" ? "true" : "false";
          else seeded[f.name] = f.value ?? "";
        }
        setValues(seeded);
      } catch (e) {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setFields([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [files]);

  const setValue = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const fillable = fields.filter((f) => !f.readOnly && f.type !== "signature");
  const loaded = files.length > 0 && !loading;
  const empty = loaded && fields.length === 0;

  const start = () =>
    void run((result) => {
      if (!("outputPath" in result)) throw new Error("Expected a file result");
      setOutputPath(result.outputPath as string);
      return "done";
    });

  const handleReset = () => {
    setOutputPath(null);
    setFields([]);
    setValues({});
    reset();
  };

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    setFiles([picked[0]]);
  };

  const renderControl = (field: FormField) => {
    if (field.type === "signature") {
      return (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          {t("tool.formFill.signature", lang)}
        </div>
      );
    }
    if (field.type === "checkbox") {
      return (
        <label className="pogopdf-radio-choice" style={{ opacity: field.readOnly ? 0.5 : 1 }}>
          <input
            type="checkbox"
            data-testid={`formfill-field-${field.name}`}
            disabled={field.readOnly}
            checked={values[field.name] === "true"}
            onChange={(e) => setValue(field.name, e.target.checked ? "true" : "false")}
          />
          {t("tool.formFill.booleanTrue", lang)}
        </label>
      );
    }
    if (field.type === "dropdown") {
      return (
        <select
          data-testid={`formfill-field-${field.name}`}
          disabled={field.readOnly}
          value={values[field.name] ?? ""}
          onChange={(e) => setValue(field.name, e.target.value)}
          style={{ ...inputStyle, width: "100%", opacity: field.readOnly ? 0.5 : 1 }}
        >
          <option value="">{t("tool.formFill.choose", lang)}</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }
    if (field.type === "radio") {
      return (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", opacity: field.readOnly ? 0.5 : 1 }}>
          {(field.options ?? []).map((option) => (
            <label
              key={option}
              className="pogopdf-radio-choice"
              style={{ cursor: field.readOnly ? "not-allowed" : "pointer" }}
            >
              <input
                type="radio"
                data-testid={`formfill-field-${field.name}-${option}`}
                name={`formfill-${field.name}`}
                disabled={field.readOnly}
                checked={values[field.name] === option}
                onChange={() => setValue(field.name, option)}
              />
              {option}
            </label>
          ))}
        </div>
      );
    }
    return (
      <input
        type="text"
        data-testid={`formfill-field-${field.name}`}
        disabled={field.readOnly}
        value={values[field.name] ?? ""}
        onChange={(e) => setValue(field.name, e.target.value)}
        style={{ ...inputStyle, width: "100%", opacity: field.readOnly ? 0.5 : 1 }}
      />
    );
  };

  return (
    <ToolFrame
      toolId={TOOL_IDS.formFill}
      job={job}
      ctaKey="tool.formFill.cta"
      canRun={files.length >= 1 && fillable.length > 0}
      hideCta={empty}
      onPick={() => void pick()}
      onRun={start}
      pickContent={
        <>
          {files.length > 0 && loading && (
            <div data-testid="formfill-loading" style={{ color: "var(--muted)", marginTop: 12 }}>
              {t("tool.formFill.loading", lang)}
            </div>
          )}
          {loadError && (
            <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{loadError}</div>
          )}
          {empty && (
            <div data-testid="formfill-empty" style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>
              {t("tool.formFill.empty", lang)}
            </div>
          )}
          {loaded && fields.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
                {t("tool.formFill.fieldsCount", lang, { count: String(fields.length) })}
              </div>
              {fields.map((field) => (
                <FieldLabel key={field.name} field={field}>
                  {renderControl(field)}
                </FieldLabel>
              ))}
              <Hint keyName="tool.formFill.latinHint" stacked />
            </div>
          )}
        </>
      }
      renderDone={() =>
        outputPath ? <SaveAsBar outputPath={outputPath} onReset={handleReset} /> : null
      }
    />
  );
}
