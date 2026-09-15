import { parsePageSelection } from "@pogopdf/contracts";

// Syntax-only validation: the UI has no page count, so parse against a large
// bound. The engine re-validates against the real count.
const SYNTAX_PAGE_COUNT = 1_000_000;

export function validatePageSpec(spec: string): string | null {
  if (!spec.trim()) return "tool.common.pagesRequired";
  try {
    parsePageSelection(spec, SYNTAX_PAGE_COUNT);
    return null;
  } catch {
    return "tool.common.pagesInvalid";
  }
}

// For optional page inputs (empty means "all pages").
export function validateOptionalPageSpec(spec: string): string | null {
  if (!spec.trim()) return null;
  return validatePageSpec(spec);
}
