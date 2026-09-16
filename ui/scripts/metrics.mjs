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
  // leafOnly skips layout containers: comparing them would flag intentional
  // modals (a fixed overlay genuinely covers the page) and nested boxes. The
  // option-form scan compares whole controls (labels wrap their inputs), so it
  // passes leafOnly=false; siblings are never ancestor/descendant of each other.
  const scanOverlaps = (root, leafOnly) => {
    const out = [];
    for (const parent of root.querySelectorAll("li, header, ul, section, form, div")) {
      if (!isVisible(parent)) continue;
      const cs = getComputedStyle(parent);
      if (!/flex|grid/.test(cs.display)) continue;
      const kids = [...parent.children].filter(
        (el) => isVisible(el) && (!leafOnly || el.childElementCount === 0)
      );
      if (kids.length < 2 || kids.length > 20) continue;
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = rectOf(kids[i]);
          const b = rectOf(kids[j]);
          const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
          const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
          const area = +(ix * iy).toFixed(2);
          if (area > 0.5) {
            out.push({
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
    return out;
  };

  const overlaps = scanOverlaps(document, true);

  // --- 2b. option-form (shared by every file tool) overlap/containment ---
  // The form stacks block children, so the flex/grid scan above never sees it.
  // Compare the direct children (fields, radio rows, hints) pairwise and check
  // they stay inside the form box.
  const formOverlaps = [];
  const formEscapes = [];
  const optForm = document.querySelector('[data-testid="options-form"]');
  if (optForm && isVisible(optForm)) {
    const formRect = rectOf(optForm);
    const kids = [...optForm.children].filter(isVisible);
    for (let i = 0; i < kids.length; i++) {
      const a = rectOf(kids[i]);
      if (
        a.x < formRect.x - 1 ||
        a.y < formRect.y - 1 ||
        a.x + a.width > formRect.x + formRect.width + 1 ||
        a.y + a.height > formRect.y + formRect.height + 1
      ) {
        formEscapes.push({ text: snippet(kids[i], 40), rect: a, formRect });
      }
      for (let j = i + 1; j < kids.length; j++) {
        const b = rectOf(kids[j]);
        const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        const area = +(ix * iy).toFixed(2);
        if (area > 0.5) {
          formOverlaps.push({
            a: { text: snippet(kids[i], 40), rect: a },
            b: { text: snippet(kids[j], 40), rect: b },
            area,
          });
        }
      }
    }
  }
  const optionsForm = optForm ? { testid: "options-form", rect: rectOf(optForm) } : null;

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

  // --- 4. file rows (generic across every FileToolScreen tool) ---
  // Selectors are suffix-generic so merge, extract, split, … all get the same
  // row invariants; the testids are `${toolId}-file-row` / `-file-name` / `-file-remove`.
  const rows = [...document.querySelectorAll('[data-testid$="-file-row"]')].map((li) => {
    const name = li.querySelector('[data-testid$="-file-name"]');
    const btn = li.querySelector('[data-testid$="-file-remove"]');
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

  // --- 4b. organize grid cells (generic: any [data-testid="grid-cell"]) ---
  // rotate(0deg) still computes as matrix(1, 0, 0, 1, 0, 0), so an identity
  // matrix counts as "not rotated"; anything else is a real rotation.
  const isIdentityTransform = (t) => {
    if (!t || t === "none") return true;
    const n = t.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
    return (
      t.startsWith("matrix(") &&
      n[0] === 1 && n[1] === 0 && n[2] === 0 && n[3] === 1
    );
  };
  const grid = document.querySelector('[data-testid="organize-grid"]');
  const gridCells = [...document.querySelectorAll('[data-testid="grid-cell"]')].map((li) => {
    const r = li.getBoundingClientRect();
    const thumb = li.querySelector('[data-testid="grid-thumb"]');
    const transform = thumb ? getComputedStyle(thumb).transform : null;
    const src = thumb?.getAttribute("src") || "";
    return {
      rect: rectOf(li),
      row: Math.round(r.top), // cells on one grid row share a top edge
      rotate: transform,
      isRotated: !isIdentityTransform(transform),
      isDragSource: getComputedStyle(li).opacity !== "1",
      isDataUrl: src.startsWith("data:image"),
    };
  });

  // Group into rows so widths compare within a row, gaps across columns.
  const gridRows = [];
  for (const cell of gridCells) {
    const row = gridRows.find((r) => Math.abs(r[0].rect.y - cell.rect.y) <= 1);
    if (row) row.push(cell);
    else gridRows.push([cell]);
  }
  const gapOf = (row) => {
    const xs = row.map((c) => c.rect.x).sort((a, b) => a - b);
    return xs.map((x, i) => (i === 0 ? null : +(x - (xs[i - 1] + row[i - 1].rect.width)).toFixed(2)));
  };
  const gridInfo = {
    count: gridCells.length,
    rect: grid ? rectOf(grid) : null,
    columnCount: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : null,
    rowCount: gridRows.length,
    rowWidthSpreads: gridRows.map((row) =>
      +(
        Math.max(...row.map((c) => c.rect.width)) - Math.min(...row.map((c) => c.rect.width))
      ).toFixed(2)
    ),
    rowHeightSpreads: gridRows.map((row) =>
      +(
        Math.max(...row.map((c) => c.rect.height)) - Math.min(...row.map((c) => c.rect.height))
      ).toFixed(2)
    ),
    gaps: gridRows.map(gapOf),
    rotatedCount: gridCells.filter((c) => c.isRotated).length,
    dragSourceCount: gridCells.filter((c) => c.isDragSource).length,
    dataUrlCount: gridCells.filter((c) => c.isDataUrl).length,
  };

  // --- 4c. Save All status rows (icon centered against the row text) ---
  const saveAllRows = [...document.querySelectorAll('[data-testid="save-all-row"]')].map((li) => {
    const icon = li.querySelector("svg");
    const text = li.querySelector("span:nth-of-type(2)") ?? li.lastElementChild;
    const ir = icon ? icon.getBoundingClientRect() : null;
    const tr = text ? text.getBoundingClientRect() : null;
    const lr = li.getBoundingClientRect();
    return {
      text: (text?.textContent || "").trim().slice(0, 80),
      title: text?.getAttribute("title") || "",
      centerDelta:
        ir && tr ? +(ir.y + ir.height / 2 - (tr.y + tr.height / 2)).toFixed(2) : null,
      rowHeight: +lr.height.toFixed(2),
    };
  });
  const saveAllRowCount = saveAllRows.length;
  const saveAllErrorCount = document.querySelectorAll('[data-testid="save-all-row"] .lucide-x, [data-testid="save-all-row"] svg.lucide-x').length;
  const saveAllRetryExists = document.querySelector('[data-testid="save-all-retry"]') !== null;

  // --- 4d. primary CTA runnable/disabled state ---
  // The testid ends in -cta for FileToolScreen tools; grid tools reuse it too.
  const ctaEl = document.querySelector('[data-testid$="-cta"]');
  const cta = ctaEl
    ? {
        testid: testId(ctaEl),
        disabled: ctaEl.disabled === true,
        background: getComputedStyle(ctaEl).backgroundColor,
        color: getComputedStyle(ctaEl).color,
        opacity: getComputedStyle(ctaEl).opacity,
      }
    : null;

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
    optionsForm,
    formOverlaps,
    formEscapes,
    clipped,
    rows,
    gridInfo,
    saveAllRows,
    saveAllRowCount,
    saveAllErrorCount,
    saveAllRetryExists,
    cta,
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

// Grid: cells on one row share a width; every cell shares one size (no layout
// shift when a page is rotated).
function checkGridCellsAligned(info) {
  if (!info || info.count === 0) return { pass: true, detail: "no grid cells" };
  const maxWidthSpread = info.rowWidthSpreads.length
    ? Math.max(...info.rowWidthSpreads)
    : 0;
  return {
    pass: maxWidthSpread <= 1,
    rowWidthSpreads: info.rowWidthSpreads,
    maxWidthSpread: +maxWidthSpread.toFixed(2),
    rowCount: info.rowCount,
  };
}

function checkGridCellsEqualSize(info) {
  if (!info || info.count === 0) return { pass: true, detail: "no grid cells" };
  const maxHeightSpread = info.rowHeightSpreads.length
    ? Math.max(...info.rowHeightSpreads)
    : 0;
  return {
    pass: maxHeightSpread <= 1,
    rowHeightSpreads: info.rowHeightSpreads,
    maxHeightSpread: +maxHeightSpread.toFixed(2),
  };
}

function checkFormNoOverlap(state) {
  const form = state.optionsForm;
  if (!form) return { pass: true, detail: "no options form" };
  const overlaps = state.formOverlaps ?? [];
  const escapes = state.formEscapes ?? [];
  return {
    pass: overlaps.length === 0 && escapes.length === 0,
    count: overlaps.length,
    overlaps,
    escapes,
  };
}

function checkSaveAllRowsCentered(rows) {
  if (!rows) return { pass: true, detail: "no rows" };
  const deltas = rows.map((r) => r.centerDelta).filter((d) => d !== null);
  if (deltas.length === 0) return { pass: true, detail: "no icons" };
  const maxAbs = Math.max(...deltas.map((d) => Math.abs(d)));
  return { pass: maxAbs <= 1, maxAbsDelta: maxAbs, deltas };
}

// A disabled CTA must still be visibly non-actionable: faded/neutral background.
const DISABLED_CTA_BG = new Set([
  "rgb(237, 238, 239)", // light --border
  "rgb(58, 57, 52)", // dark --border
]);

// States where the primary CTA's enabled/disabled rendering is an asserted
// invariant. Keyed by state name so the check scales as tools are added.
const CTA_EXPECTATIONS = {
  "split-form": false, // valid ranges → enabled
  "split-invalid": true, // "abc" → disabled
  "extract-form": false,
  "booklet-form": false,
  "nup-form": false,
  "rotate-form": false,
};

function checkCtaDisabledVisible(cta, expectedDisabled) {
  if (!cta) return { pass: true, detail: "no cta" };
  const pass = expectedDisabled
    ? cta.disabled && DISABLED_CTA_BG.has(cta.background)
    : !cta.disabled && !DISABLED_CTA_BG.has(cta.background);
  return { pass, cta, expectedDisabled };
}

// Real-pdf.js state: the blob-backed fixture must produce real data-URL
// thumbnails (not the mock canvases) and honor the pre-rotated page 2, which
// is seeded as a 90° absolute rotation on its grid cell.
function checkRealPdfGrid(info) {
  if (!info) return { pass: false, detail: "no grid info" };
  return {
    pass: info.count === 2 && info.dataUrlCount === 2 && info.rotatedCount === 1,
    count: info.count,
    dataUrlCount: info.dataUrlCount,
    rotatedCount: info.rotatedCount,
  };
}

// Returns { invariants, evidence } for one captured state.
export function evaluateState(name, state) {
  const invariants = {
    "no-overlap": state.overlaps.length === 0,
    "form-no-overlap": checkFormNoOverlap(state).pass,
    "no-unintended-clipping": state.clipped.length === 0,
    "rows-centered": checkRowsCentered(state.rows).pass,
    "rows-consistent-height": checkRowsConsistentHeight(state.rows).pass,
    "grid-cells-aligned": checkGridCellsAligned(state.gridInfo).pass,
    "grid-cells-equal-size": checkGridCellsEqualSize(state.gridInfo).pass,
    "saveall-rows-centered": checkSaveAllRowsCentered(state.saveAllRows).pass,
    "cta-disabled-visible": null, // only asserted for states in CTA_EXPECTATIONS
    "dragover-state-visible": null, // cross-state, filled in by buildReport
    "theme-tokens-correct": null, // only meaningful for home-* states
    "grid-real-thumbs": null, // only asserted for organize-grid-real
  };

  if (name === "home-light" || name === "home-dark") {
    invariants["theme-tokens-correct"] = checkThemeTokens(state).pass;
  }
  if (name in CTA_EXPECTATIONS) {
    invariants["cta-disabled-visible"] = checkCtaDisabledVisible(
      state.cta,
      CTA_EXPECTATIONS[name]
    ).pass;
  }
  if (name === "organize-grid-real") {
    invariants["grid-real-thumbs"] = checkRealPdfGrid(state.gridInfo).pass;
  }

  const expectations = {
    grid: checkGridCellsAligned(state.gridInfo),
    gridEqualSize: checkGridCellsEqualSize(state.gridInfo),
    gridCellsDifferAcrossRotate: state.gridInfo
      ? { count: state.gridInfo.count, rotated: state.gridInfo.rotatedCount }
      : null,
  };

  const evidence = {
    overlapCount: state.overlaps.length,
    overlaps: state.overlaps,
    formNoOverlap: checkFormNoOverlap(state),
    clippedCount: state.clipped.length,
    clipped: state.clipped,
    rowCount: state.rows.length,
    rows: state.rows,
    rowsCentered: checkRowsCentered(state.rows),
    rowsConsistentHeight: checkRowsConsistentHeight(state.rows),
    gridCellsAligned: checkGridCellsAligned(state.gridInfo),
    gridCellsEqualSize: checkGridCellsEqualSize(state.gridInfo),
    gridInfo: state.gridInfo,
    realPdfGrid: name === "organize-grid-real" ? checkRealPdfGrid(state.gridInfo) : null,
    saveAllRows: state.saveAllRows,
    saveAllRowsCentered: checkSaveAllRowsCentered(state.saveAllRows),
    saveAllRowCount: state.saveAllRowCount,
    cta: state.cta,
    textNodeCount: state.textNodes.length,
    bodyBg: state.bodyBg,
    isDark: state.isDark,
    themeTokens: name === "home-light" || name === "home-dark" ? checkThemeTokens(state) : null,
    dropZone: state.dropZone,
    viewport: state.viewport,
    expectations,
  };

  return { invariants, evidence, expectations };
}

// Cross-state: the rotate action must show up as a transform on the thumbnail
// while the grid geometry itself stays identical.
export function evaluateGridRotate(plainState, rotatedState) {
  const a = plainState?.gridInfo;
  const b = rotatedState?.gridInfo;
  const pass = Boolean(
    a &&
      b &&
      a.count === b.count &&
      a.rowCount === b.rowCount &&
      b.rotatedCount > a.rotatedCount &&
      a.columnCount === b.columnCount &&
      Math.abs(a.rect?.width - b.rect?.width) < 1
  );
  return {
    pass,
    plain: a ? { count: a.count, rowCount: a.rowCount, rotated: a.rotatedCount } : null,
    rotated: b ? { count: b.count, rowCount: b.rowCount, rotated: b.rotatedCount } : null,
  };
}

// Cross-state: the dragged cell must be visually distinguished from the cells
// around it (opacity/border), and the grid geometry must not change.
export function evaluateGridDragging(restState, dragState) {
  const a = restState?.gridInfo;
  const b = dragState?.gridInfo;
  const pass = Boolean(
    a && b && a.count === b.count && b.dragSourceCount > 0 && a.dragSourceCount === 0
  );
  return {
    pass,
    rest: a ? { count: a.count, dragSources: a.dragSourceCount } : null,
    dragging: b ? { count: b.count, dragSources: b.dragSourceCount } : null,
  };
}

// Cross-state: the Save All error state must render exactly one failed row and
// a Retry action, while keeping every row icon centered.
export function evaluateSaveAllError(happyState, errorState) {
  const happy = happyState?.saveAllRowCount ?? 0;
  const rows = errorState?.saveAllRowCount ?? 0;
  const retry = errorState?.saveAllRetryExists === true;
  const pass = Boolean(
    happy > 0 && rows === happy && errorState?.saveAllErrorCount === 1 && retry
  );
  return {
    pass,
    happyRows: happy,
    errorRows: rows,
    errorRowsWithX: errorState?.saveAllErrorCount ?? 0,
    retryVisible: retry,
  };
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
