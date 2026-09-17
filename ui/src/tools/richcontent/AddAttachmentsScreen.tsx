import { useState } from "react";
import { X } from "lucide-react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickAnyFiles } from "../../app/rpc";
import { FileToolScreen } from "../FileToolScreen";
import { Hint } from "../organize/forms";
import { basename } from "../paths";

// The main PDF arrives through the standard drop zone; attachment files are any
// type, so they get a second picker and a simple name+remove row list (not
// thumbnail cards: arbitrary files have no preview pipeline).
export function AddAttachmentsScreen() {
  const { lang } = useApp();
  const [attachments, setAttachments] = useState<string[]>([]);

  const addAttachments = async () => {
    const picked = await pickAnyFiles(true);
    if (picked.length === 0) return;
    setAttachments((prev) => [...new Set([...prev, ...picked])]);
  };

  return (
    <FileToolScreen
      toolId={TOOL_IDS.addAttachments}
      acceptMultiple={false}
      ctaKey="tool.addAttachments.cta"
      validationError={() =>
        attachments.length === 0 ? "tool.addAttachments.emptyHint" : null
      }
      buildInput={(files) => ({ filePath: files[0], attachments })}
      dropKeys={{
        multiple: "tool.addAttachments.drop",
        single: "tool.addAttachments.dropSingle",
      }}
      options={
        <div style={{ gridColumn: "1 / -1" }} data-testid="addAttachments-files">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            {t("tool.addAttachments.filesLabel", lang)}
          </div>
          <button
            data-testid="addAttachments-add"
            onClick={() => void addAttachments()}
            style={{
              padding: "8px 16px", borderRadius: "var(--radius-pill)", fontWeight: 600,
              background: "transparent", border: "1px solid var(--border)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            {t("tool.addAttachments.addFiles", lang)}
          </button>
          {attachments.length > 0 && (
            <>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                {t("tool.addAttachments.selected", lang, { count: String(attachments.length) })}
              </div>
              <ul
                data-testid="addAttachments-list"
                style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}
              >
                {attachments.map((path) => (
                  <li
                    key={path}
                    data-testid="addAttachments-attachment-row"
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "6px 0", borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span
                      title={path}
                      style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}
                    >
                      {basename(path)}
                    </span>
                    <button
                      data-testid="addAttachments-attachment-remove"
                      aria-label={`${t("tool.common.remove", lang)}: ${basename(path)}`}
                      onClick={() =>
                        setAttachments((prev) => prev.filter((x) => x !== path))
                      }
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        border: "none", background: "transparent", color: "var(--danger)",
                        cursor: "pointer", padding: 4,
                      }}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Hint keyName="tool.addAttachments.hint" stacked />
        </div>
      }
    />
  );
}
