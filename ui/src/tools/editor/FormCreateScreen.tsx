import { useState } from "react";
import { Plus, X } from "lucide-react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickPdfs } from "../../app/rpc";
import { SaveAsBar } from "../../components/SaveAsBar";
import { usePdfJob } from "../usePdfJob";
import { Field, Hint, NumberInput } from "../organize/forms";
import { ToolFrame } from "../ToolFrame";

type FieldType = "text" | "checkbox" | "dropdown";

type Row = {
  name: string;
  label: string;
  type: FieldType;
  options: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const EMPTY_ROW: Row = {
  name: "",
  label: "",
  type: "text",
  options: "",
  x: 72,
  y: 720,
  w: 150,
  h: 24,
};

const cellStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 14,
} as const;

// v1 places fields by coordinate entry, not a drag canvas: the plan's
// click-to-place flow is deferred to v1.1. Each row carries its own name, type,
// option list (dropdown) and displayed-frame box.
export function FormCreateScreen() {
  const { lang } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const parsedOptions = (row: Row) =>
    row.options.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

  const rowValid = (row: Row) =>
    row.name.trim().length > 0 &&
    Number.isFinite(row.x) &&
    Number.isFinite(row.y) &&
    Number.isFinite(row.w) &&
    row.w >= 1 &&
    Number.isFinite(row.h) &&
    row.h >= 1 &&
    (row.type !== "dropdown" || parsedOptions(row).length > 0);

  const rowsInvalid = rows.some((row) => !rowValid(row));
  const validationKey =
    rows.length === 0
      ? "tool.formCreate.empty"
      : rowsInvalid
        ? rows.some((r) => r.type === "dropdown" && parsedOptions(r).length === 0)
          ? "tool.formCreate.optionsRequired"
          : "tool.formCreate.rowInvalid"
        : null;

  const job = usePdfJob(TOOL_IDS.formCreate, (fs) => ({
    filePath: fs[0],
    page,
    fields: rows.map((row) => {
      const field: Record<string, unknown> = {
        name: row.name,
        label: row.label,
        type: row.type,
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
      };
      if (row.type === "dropdown") field.options = parsedOptions(row);
      return field;
    }),
  }));
  const { files, setFiles, reset, run } = job;

  const setRow = (index: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));
  const addRow = () => setRows((prev) => [...prev, { ...EMPTY_ROW }]);

  const start = () =>
    void run((result) => {
      if (!("outputPath" in result)) throw new Error("Expected a file result");
      setOutputPath(result.outputPath as string);
      return "done";
    });

  const handleReset = () => {
    setOutputPath(null);
    setRows([]);
    reset();
  };

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    setFiles([picked[0]]);
  };

  const runnable = files.length >= 1 && rows.length > 0 && !rowsInvalid;

  return (
    <ToolFrame
      toolId={TOOL_IDS.formCreate}
      job={job}
      ctaKey="tool.formCreate.cta"
      canRun={runnable}
      validationKey={files.length > 0 ? validationKey : null}
      onPick={() => void pick()}
      onRun={start}
      pickContent={
        <div data-testid="formcreate-fields" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            {t("tool.formCreate.fieldsLabel", lang)}
          </div>
          {rows.map((row, i) => (
            <div
              key={i}
              data-testid="data-row"
              style={{
                display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end",
                padding: "10px 0", borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  {t("tool.formCreate.nameField", lang)}
                </div>
                <input
                  data-testid={`formcreate-name-${i}`}
                  value={row.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                  style={{ ...cellStyle, width: "100%" }}
                />
              </div>
              <div style={{ flex: "1 1 130px", minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  {t("tool.formCreate.labelField", lang)}
                </div>
                <input
                  data-testid={`formcreate-label-${i}`}
                  value={row.label}
                  onChange={(e) => setRow(i, { label: e.target.value })}
                  style={{ ...cellStyle, width: "100%" }}
                />
              </div>
              <div style={{ flex: "0 1 110px" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  {t("tool.formCreate.typeField", lang)}
                </div>
                <select
                  data-testid={`formcreate-type-${i}`}
                  value={row.type}
                  onChange={(e) => setRow(i, { type: e.target.value as FieldType })}
                  style={{ ...cellStyle, width: "100%" }}
                >
                  <option value="text">{t("tool.formCreate.typeText", lang)}</option>
                  <option value="checkbox">{t("tool.formCreate.typeCheckbox", lang)}</option>
                  <option value="dropdown">{t("tool.formCreate.typeDropdown", lang)}</option>
                </select>
              </div>
              {(["x", "y", "w", "h"] as const).map((key) => (
                <div key={key} style={{ flex: "0 0 62px" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    {t(`tool.formCreate.${key}Field`, lang)}
                  </div>
                  <input
                    type="number"
                    data-testid={`formcreate-${key}-${i}`}
                    value={Number.isFinite(row[key]) ? row[key] : ""}
                    onChange={(e) =>
                      setRow(i, { [key]: e.target.value === "" ? NaN : Number(e.target.value) })
                    }
                    style={{ ...cellStyle, width: "100%" }}
                  />
                </div>
              ))}
              <button
                data-testid={`formcreate-remove-${i}`}
                onClick={() => removeRow(i)}
                aria-label={t("tool.formCreate.removeField", lang)}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  border: "none", background: "transparent", color: "var(--danger)",
                  cursor: "pointer", padding: 8,
                }}
              >
                <X size={16} />
              </button>
              {row.type === "dropdown" && (
                <div style={{ flex: "1 1 100%" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    {t("tool.formCreate.optionsField", lang)}
                  </div>
                  <input
                    data-testid={`formcreate-options-${i}`}
                    value={row.options}
                    onChange={(e) => setRow(i, { options: e.target.value })}
                    placeholder="Yes, No, Maybe"
                    style={{ ...cellStyle, width: "100%" }}
                  />
                </div>
              )}
            </div>
          ))}
          <button
            data-testid="formcreate-add"
            onClick={addRow}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10,
              padding: "8px 14px", borderRadius: "var(--radius-pill)", fontWeight: 600,
              background: "transparent", border: "1px solid var(--border)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            <Plus size={14} /> {t("tool.formCreate.addField", lang)}
          </button>
          <div style={{ marginTop: 12 }}>
            <Field labelKey="tool.formCreate.pageField">
              <NumberInput
                testId="formcreate-page"
                value={page}
                onChange={setPage}
                min={1}
                invalid={!Number.isInteger(page) || page < 1}
              />
            </Field>
          </div>
          <Hint keyName="tool.formCreate.coordinateHint" stacked />
          <Hint keyName="tool.formCreate.latinHint" stacked />
        </div>
      }
      renderDone={() =>
        outputPath ? <SaveAsBar outputPath={outputPath} onReset={handleReset} /> : null
      }
    />
  );
}
