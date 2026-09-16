import type { ReactNode } from "react";
import { useApp } from "../../app/store";
import { t } from "@pogopdf/i18n";

export function Field({ labelKey, children }: { labelKey: string; children: ReactNode }) {
  const { lang } = useApp();
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {t(labelKey, lang)}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 14,
} as const;

export type Choice = { value: string; labelKey: string };

export function RadioGroup({
  name,
  value,
  choices,
  onChange,
  disabled = false,
}: {
  name: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { lang } = useApp();
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", opacity: disabled ? 0.5 : 1 }}>
      {choices.map((c) => (
        <label
          key={c.value}
          className="pogopdf-radio-choice"
          style={{ cursor: disabled ? "not-allowed" : "pointer" }}
        >
          <input
            type="radio"
            name={name}
            value={c.value}
            disabled={disabled}
            checked={value === c.value}
            onChange={() => onChange(c.value)}
          />
          {t(c.labelKey, lang)}
        </label>
      ))}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <input
      type="text"
      data-testid={testId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...inputStyle, width: "100%" }}
    />
  );
}

export type Option = { value: string; label: string };

export function Select({
  value,
  onChange,
  options,
  testId,
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  testId?: string;
  width?: number;
}) {
  return (
    <select
      data-testid={testId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, width }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  testId,
  invalid = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  testId?: string;
  invalid?: boolean;
}) {
  return (
    <input
      type="number"
      data-testid={testId}
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      style={{
        ...inputStyle,
        width: 120,
        borderColor: invalid ? "var(--danger)" : "var(--border)",
      }}
    />
  );
}

export function Hint({ keyName }: { keyName: string }) {
  const { lang } = useApp();
  return (
    <div
      style={{
        color: "var(--muted)",
        fontSize: 12,
        marginTop: 6,
        // Keep a hint from butting against the next field label when it sits
        // between two fields (e.g. the conditional quality hint).
        marginBottom: 6,
      }}
    >
      {t(keyName, lang)}
    </div>
  );
}
