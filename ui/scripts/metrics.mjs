// Layout-metrics collection + invariant evaluation for the screenshot harness.
//
// The page-side collector (collectPageMetrics) is serialized into the browser by
// page.evaluate; it must be self-contained (no closure over module scope).
// Node-side helpers turn the raw numbers into per-state PASS/FAIL invariants.

// Theme tokens read from ui/src/theme.css. Kept as computed rgb() strings.
export const THEME_TOKENS = {
  light: { bg: "rgb(245, 245, 240)" }, // #F5F5F0
  dark: { bg: "rgb(28, 28, 26)" }, // #1C1C1A
};

// Injected into the page. Keep pure: page.evaluate(collectPageMetrics).
export function collectPageMetrics() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: +r.x.toFixed(2),
      y: +r.y.toFixed(2),
      width: +r.width.toFixed(2),
      height: +r.height.toFixed(2),
    };
  };

  const snippet = (el, len = 60) => {
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    return txt.slice(0, len);
  };

  const testId = (el) => el.getAttribute("data-testid") || undefined;

  // --- 1. visible text containers / buttons ---
  const textNodes = [];
  const TEXT_QUERY = "button, a, input, h1, h2, p, li, span, strong, em, label, section, div";
  for (const el of document.querySelectorAll(TEXT_QUERY)) {
    if (!isVisible(el)) continue;
    const isInput = el.tagName === "INPUT";
    const leaf = el.childElementCount === 0;
    const hasOwnText = leaf && (el.textContent || "").trim().length > 0;
    const isButton = el.tagName === "BUTTON" || el.tagName === "A";
    if (!isInput && !hasOwnText && !isButton) continue;
    textNodes.push({
      tag: el.tagName.toLowerCase(),
      testid: testId(el),
      text: isInput ? el.getAttribute("placeholder") || "" : snippet(el),
      rect: rectOf(el),
    });
  }

  // --- 2. sibling overlap within flex/grid rows ---
  const overlaps = [];
  for (const parent of document.querySelectorAll("li, header, ul, section, form, div")) {
    if (!isVisible(parent)) continue;
    const cs = getComputedStyle(parent);
    if (!/flex|grid/.test(cs.display)) continue;
    // Leaf siblings only: comparing layout containers flags intentional modals
    // (a fixed overlay genuinely covers the page) and nested boxes.
    const kids = [...parent.children].filter((el) => isVisible(el) && el.childElementCount === 0);
    if (kids.length < 2 || kids.length > 20) continue;
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = rectOf(kids[i]);
        const b = rectOf(kids[j]);
        const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        const area = +(ix * iy).toFixed(2);
        if (area > 0.5) {
          overlaps.push({
            parent: parent.tagName.toLowerCase(),
            parentTestid: testId(parent),
            a: { tag: kids[i].tagName.toLowerCase(), text: snippet(kids[i], 40), rect: a },
            b: { tag: kids[j].tagName.toLowerCase(), text: snippet(kids[j], 40), rect: b },
            area,
          });
        }
      }
    }
  }

  // --- 3. clipping (text overflowing its box) ---
  // Intentional scroll containers (computed overflow auto/scroll) and the
  // document/root wrappers are excluded: the page scroll is by design.
  const clipped = [];
  for (const el of document.querySelectorAll("body *")) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style") continue;
    if (!isVisible(el)) continue;
    // The main window scroll lives on html/body (and #root); its overflow is by
    // design, as is any explicitly scrollable container.
    if (tag === "html" || tag === "body" || el.id === "root") continue;
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY)) continue;
    const dw = el.scrollWidth - el.clientWidth;
    const dh = el.scrollHeight - el.clientHeight;
    if (dw > 1 || dh > 1) {
      clipped.push({
        tag,
        testid: testId(el),
        text: snippet(el),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
      });
    }
  }

  // --- 4. merge file rows ---
  const rows = [...document.querySelectorAll('[data-testid="merge-file-row"]')].map((li) => {
    const name = li.querySelector('[data-testid="merge-file-name"]');
    const btn = li.querySelector('[data-testid="merge-file-remove"]');
    const lr = li.getBoundingClientRect();
    const nr = name.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const nameCenter = nr.y + nr.height / 2;
    const btnCenter = br.y + br.height / 2;
    return {
      nameText: (name.textContent || "").trim().slice(0, 80),
      rowHeight: +lr.height.toFixed(2),
      nameHeight: +nr.height.toFixed(2),
      nameWidth: +nr.width.toFixed(2),
      centerDelta: +(btnCenter - nameCenter).toFixed(2),
    };
  });

  // --- 5. drop zone + theme tokens ---
  const dz = document.querySelector('[data-testid="merge-dropzone"]');
  const dropZone = dz
    ? {
        text: snippet(dz),
        borderColor: getComputedStyle(dz).borderTopColor,
        borderStyle: getComputedStyle(dz).borderTopStyle,
        borderWidth: getComputedStyle(dz).borderTopWidth,
        backgroundColor: getComputedStyle(dz).backgroundColor,
      }
    : null;

  return {
    viewport: { width: vw, height: vh },
    isDark: document.documentElement.classList.contains("dark"),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    textNodes,
    overlaps,
    clipped,
    rows,
    dropZone,
  };
}

// --- invariant evaluation (node side) ---

function checkRowsCentered(rows) {
  if (!rows || rows.length === 0) return { pass: true, detail: "no rows" };
  const deltas = rows.map((r) => r.centerDelta);
  const maxAbs = Math.max(...deltas.map((d) => Math.abs(d)));
  return { pass: maxAbs <= 1, maxAbsDelta: maxAbs, deltas };
}

function checkRowsConsistentHeight(rows) {
  if (!rows || rows.length < 2) return { pass: true, detail: "fewer than 2 rows" };
  const minNameHeight = Math.min(...rows.map((r) => r.nameHeight));
  const singleLine = rows.filter((r) => r.nameHeight <= minNameHeight + 2);
  const wrapped = rows.filter((r) => r.nameHeight > minNameHeight + 2);
  const heights = singleLine.map((r) => r.rowHeight);
  const spread = heights.length > 0 ? Math.max(...heights) - Math.min(...heights) : 0;
  return {
    pass: spread <= 1,
    singleLineNameHeight: minNameHeight,
    singleLineRowHeights: heights,
    wrappedRowHeights: wrapped.map((r) => r.rowHeight),
    spread: +spread.toFixed(2),
  };
}

function checkThemeTokens(state) {
  const expected = state.isDark ? THEME_TOKENS.dark.bg : THEME_TOKENS.light.bg;
  return {
    pass: state.bodyBg === expected,
    actual: state.bodyBg,
    expected,
    isDark: state.isDark,
  };
}

// Returns { invariants, evidence } for one captured state.
export function evaluateState(name, state) {
  const invariants = {
    "no-overlap": state.overlaps.length === 0,
    "no-unintended-clipping": state.clipped.length === 0,
    "rows-centered": checkRowsCentered(state.rows).pass,
    "rows-consistent-height": checkRowsConsistentHeight(state.rows).pass,
    "dragover-state-visible": null, // cross-state, filled in by buildReport
    "theme-tokens-correct": null, // only meaningful for home-* states
  };

  if (name === "home-light" || name === "home-dark") {
    invariants["theme-tokens-correct"] = checkThemeTokens(state).pass;
  }

  const evidence = {
    overlapCount: state.overlaps.length,
    overlaps: state.overlaps,
    clippedCount: state.clipped.length,
    clipped: state.clipped,
    rowCount: state.rows.length,
    rows: state.rows,
    rowsCentered: checkRowsCentered(state.rows),
    rowsConsistentHeight: checkRowsConsistentHeight(state.rows),
    textNodeCount: state.textNodes.length,
    bodyBg: state.bodyBg,
    isDark: state.isDark,
    themeTokens: name === "home-light" || name === "home-dark" ? checkThemeTokens(state) : null,
    dropZone: state.dropZone,
    viewport: state.viewport,
  };

  return { invariants, evidence };
}

// Cross-state invariant: drag-over must visibly change the drop zone.
export function evaluateDragover(emptyState, dragoverState) {
  const a = emptyState?.dropZone;
  const b = dragoverState?.dropZone;
  const pass = Boolean(
    a && b && a.borderColor !== b.borderColor && a.backgroundColor !== b.backgroundColor
  );
  return {
    pass,
    empty: a,
    dragover: b,
  };
}
