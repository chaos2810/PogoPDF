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
    // Two-line clamped file names overflow their box by design (overflow:hidden
    // plus -webkit-line-clamp); that is not unintended clipping.
    if (cs.webkitLineClamp && cs.webkitLineClamp !== "none") continue;
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

  // --- 4. file cards (generic across every FileToolScreen tool) ---
  // Each queued file is a fixed-width thumbnail card: preview on top, name below
  // with a two-line clamp, delete ✕ overlaid in the card's top-right corner.
  // Selectors are suffix-generic so merge, extract, split, … all get the same
  // card invariants; the testids are `${toolId}-file-row` / `-file-name` / `-file-remove`.
  const rows = [...document.querySelectorAll('[data-testid$="-file-row"]')].map((li) => {
    const name = li.querySelector('[data-testid$="-file-name"]');
    const btn = li.querySelector('[data-testid$="-file-remove"]');
    const thumb = li.querySelector('[data-testid$="-file-thumb"]');
    const lr = li.getBoundingClientRect();
    const nr = name.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const tr = thumb ? thumb.getBoundingClientRect() : null;
    return {
      nameText: (name.textContent || "").trim().slice(0, 80),
      cardX: +lr.x.toFixed(2),
      cardY: +lr.y.toFixed(2),
      cardWidth: +lr.width.toFixed(2),
      cardHeight: +lr.height.toFixed(2),
      nameX: +nr.x.toFixed(2),
      nameWidth: +nr.width.toFixed(2),
      nameHeight: +nr.height.toFixed(2),
      // ✕ must sit a constant offset inside the card's top-right corner.
      removeInsetRight: +(lr.x + lr.width - (br.x + br.width)).toFixed(2),
      removeInsetTop: +(br.y - lr.y).toFixed(2),
      // Name must stay within the card's horizontal band.
      nameInsideCard:
        nr.x >= lr.x - 1 && nr.x + nr.width <= lr.x + lr.width + 1,
      // Thumbnail must sit above the name (stacked card), not beside it.
      thumbAboveName: tr ? tr.y + tr.height <= nr.y + 1 : true,
      hasThumb: Boolean(thumb?.querySelector("img")),
    };
  });

  // Group cards into visual rows so per-row geometry compares like with like.
  const cardRows = [];
  for (const card of rows) {
    const row = cardRows.find((r) => Math.abs(r[0].cardY - card.cardY) <= 1);
    if (row) row.push(card);
    else cardRows.push([card]);
  }
  const cardsInfo = {
    count: rows.length,
    rowCount: cardRows.length,
    widths: rows.map((r) => r.cardWidth),
    heights: rows.map((r) => r.cardHeight),
    removeInsetRights: rows.map((r) => r.removeInsetRight),
    removeInsetTops: rows.map((r) => r.removeInsetTop),
    nameInsideCard: rows.every((r) => r.nameInsideCard),
    thumbAboveName: rows.every((r) => r.thumbAboveName),
    thumbCount: rows.filter((r) => r.hasThumb).length,
  };

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
    return {
      rect: rectOf(li),
      row: Math.round(r.top), // cells on one grid row share a top edge
      rotate: transform,
      isRotated: !isIdentityTransform(transform),
      isDragSource: getComputedStyle(li).opacity !== "1",
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

  // --- 4e. data-view rows (View Metadata dl + Page Dimensions table) ---
  // Both renderers tag their container data-rows and every row data-row, so one
  // collector covers the flex/dl and the table shapes. Cell centers within a row
  // catch vertical misalignment; first-cell x/width across rows catch a ragged
  // label column (the table's own cells are not flex/grid, so the generic
  // sibling scan above never sees them).
  const rectList = (els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) };
  });
  const dataRows = [...document.querySelectorAll('[data-testid="data-row"]')].map((row) => {
    const kids = [...row.children].filter(isVisible);
    const rects = rectList(kids);
    const centers = rects.map((r) => +(r.y + r.height / 2).toFixed(2));
    const base = centers[0] ?? 0;
    const first = rects[0] ?? { x: 0, width: 0 };
    return {
      text: snippet(row, 60),
      cellCount: rects.length,
      cellCenterDelta: +Math.max(0, ...centers.map((c) => Math.abs(c - base))).toFixed(2),
      firstCellX: first.x,
      firstCellWidth: first.width,
      rowHeight: +row.getBoundingClientRect().height.toFixed(2),
    };
  });
  const dataRowCount = dataRows.length;

  // --- 4e1. workflow step rows (Workflow Builder) ---
  // Each step is a bordered card: a numbered header with a danger remove chip in
  // its top-right corner, a tool select, and a monospace JSON textarea. The step
  // cards must share one width and one left edge; the remove chip must sit at a
  // constant inset in every card.
  const workflowSteps = [...document.querySelectorAll('[data-testid^="workflow-step-"]')].map((li) => {
    const r = li.getBoundingClientRect();
    const remove = li.querySelector('[data-testid^="workflow-remove-"]');
    const rr = remove?.getBoundingClientRect();
    return {
      cardX: +r.x.toFixed(2),
      cardY: +r.y.toFixed(2),
      cardWidth: +r.width.toFixed(2),
      cardHeight: +r.height.toFixed(2),
      removeInsetRight: rr ? +(r.x + r.width - (rr.x + rr.width)).toFixed(2) : null,
      removeInsetTop: rr ? +(rr.y - r.y).toFixed(2) : null,
      hasSelect: li.querySelector('select[data-testid^="workflow-tool-"]') !== null,
      hasTextarea: li.querySelector('textarea[data-testid^="workflow-input-"]') !== null,
    };
  });
  const workflowInfo = {
    count: workflowSteps.length,
    cards: workflowSteps,
    widths: workflowSteps.map((s) => s.cardWidth),
    xs: workflowSteps.map((s) => s.cardX),
    removeInsetRights: workflowSteps.map((s) => s.removeInsetRight).filter((v) => v !== null),
    removeInsetTops: workflowSteps.map((s) => s.removeInsetTop).filter((v) => v !== null),
    complete: workflowSteps.every((s) => s.hasSelect && s.hasTextarea),
  };

  // --- 4e2. bookmark tree rows (View Bookmarks) ---
  // The outline is a tree, so the data-row label-column check does not apply
  // (the indent is intentional). Collect each row's nesting depth (data-depth)
  // and the x of its title span: deeper rows must sit further right.
  const bookmarkRows = [...document.querySelectorAll('[data-testid="bookmark-row"]')].map((li) => {
    const depth = Number(li.getAttribute("data-depth") ?? "0") || 0;
    const content = li.querySelector(":scope > div");
    const title = content?.firstElementChild ?? content ?? li;
    const r = title.getBoundingClientRect();
    return {
      depth,
      x: +r.x.toFixed(2),
      width: +r.width.toFixed(2),
      text: snippet(li, 40),
    };
  });

  // Table-shaped data rows: columns must line up across rows and no two cells in
  // a row may overlap (table display is not flex/grid).
  const dataTables = [...document.querySelectorAll('table[data-testid="data-rows"]')].map((table) => {
    const rowRects = [...table.querySelectorAll("tr")]
      .filter(isVisible)
      .map((tr) => rectList([...tr.children].filter(isVisible)));
    const colCount = rowRects[0]?.length ?? 0;
    let xSpread = 0;
    let widthSpread = 0;
    for (let c = 0; c < colCount; c++) {
      const colX = rowRects.map((r) => r[c]?.x).filter((v) => v !== undefined);
      const colW = rowRects.map((r) => r[c]?.width).filter((v) => v !== undefined);
      if (colX.length) xSpread = Math.max(xSpread, Math.max(...colX) - Math.min(...colX));
      if (colW.length) widthSpread = Math.max(widthSpread, Math.max(...colW) - Math.min(...colW));
    }
    const overlaps = [];
    for (let i = 0; i < rowRects.length; i++) {
      for (let a = 0; a < rowRects[i].length; a++) {
        for (let b = a + 1; b < rowRects[i].length; b++) {
          const A = rowRects[i][a];
          const B = rowRects[i][b];
          const ix = Math.max(0, Math.min(A.x + A.width, B.x + B.width) - Math.max(A.x, B.x));
          const iy = Math.max(0, Math.min(A.y + A.height, B.y + B.height) - Math.max(A.y, B.y));
          const area = +(ix * iy).toFixed(2);
          if (area > 0.5) overlaps.push({ row: i, cols: [a, b], area });
        }
      }
    }
    return { rowCount: rowRects.length, colCount, xSpread: +xSpread.toFixed(2), widthSpread: +widthSpread.toFixed(2), overlaps };
  });

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

  // --- 4f. editor overlay (page bitmap, annotation geometry, selection, search) ---
  // The annotation wrapper is a full-page layer (inset:0), so the mark's own
  // geometry lives on its first child element. Comparing that against the
  // editor-page box proves the overlay lines up with the rendered page instead
  // of drifting. Freehand is an inset:0 SVG and is skipped by the alignment
  // check (its ink bounds are not a rect).
  const editorPageEl = document.querySelector('[data-testid="editor-page"]');
  const markBodyRect = (el) => {
    const body = el.firstElementChild;
    if (!body) return null;
    const r = body.getBoundingClientRect();
    return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) };
  };
  const editorSelectionEl = document.querySelector('[data-testid="editor-selection"]');
  const editorRailEl = document.querySelector('[data-testid="editor-tool-rail"]');
  const editorPulseEl = document.querySelector('[data-testid="editor-search-pulse"]');
  const editorCanvasEl = document.querySelector('[data-testid="editor-canvas"]');
  // Sample the rendered bitmap for non-white pixels: a blank page is a real
  // regression the geometry checks cannot see. A data: URL image taints no
  // canvas, so getImageData is safe; a 64px-wide sample is plenty.
  const bitmapEl = document.querySelector('[data-testid="editor-page-bitmap"]');
  let inkFraction = null;
  if (bitmapEl instanceof HTMLImageElement && bitmapEl.complete && bitmapEl.naturalWidth > 0) {
    try {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 90;
      const cx = c.getContext("2d");
      cx.drawImage(bitmapEl, 0, 0, 64, 90);
      const data = cx.getImageData(0, 0, 64, 90).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) ink++;
      }
      inkFraction = ink / (64 * 90);
    } catch {
      inkFraction = null;
    }
  }
  const editorInfo = editorPageEl
    ? {
        page: rectOf(editorPageEl),
        hasBitmap: bitmapEl !== null,
        inkFraction,
        annotations: [...document.querySelectorAll('[data-testid="editor-annotation"]')].map((el) => ({
          type: el.getAttribute("data-item-type"),
          selected: el.getAttribute("data-selected") === "true",
          body: markBodyRect(el),
        })),
        canvas: editorCanvasEl ? rectOf(editorCanvasEl) : null,
        selection: editorSelectionEl?.firstElementChild
          ? rectOf(editorSelectionEl.firstElementChild)
          : null,
        handles: [...document.querySelectorAll('[data-testid^="editor-handle-"]')].map(rectOf),
        toolRail: editorRailEl ? rectOf(editorRailEl) : null,
        toolCount: editorRailEl ? editorRailEl.querySelectorAll("button").length : 0,
        activeTool: editorRailEl
          ? editorRailEl.querySelectorAll('button[aria-pressed="true"]').length
          : 0,
        pulse: editorPulseEl ? rectOf(editorPulseEl) : null,
        results: document.querySelectorAll('[data-testid="editor-search-result"]').length,
        redactMark: document.querySelector('[data-testid="editor-redact-mark"]') !== null,
        redactHint: document.querySelector('[data-testid="editor-redact-hint"]') !== null,
        // In-place text edit: the inline editor overlay + its prefilled input.
        textEdit: (() => {
          const overlay = document.querySelector('[data-testid="editor-textedit-overlay"]');
          if (!overlay) return null;
          const input = document.querySelector('[data-testid="editor-textedit-input"]');
          return {
            overlay: rectOf(overlay),
            inputValue: input instanceof HTMLInputElement ? input.value : null,
            hasApply: document.querySelector('[data-testid="editor-textedit-apply"]') !== null,
            hasCancel: document.querySelector('[data-testid="editor-textedit-cancel"]') !== null,
          };
        })(),
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
    cardsInfo,
    dataRows,
    dataRowCount,
    workflowInfo,
    bookmarkRows,
    dataTables,
    gridInfo,
    saveAllRows,
    saveAllRowCount,
    saveAllErrorCount,
    saveAllRetryExists,
    editorInfo,
    cta,
    dropZone,
  };
}

// --- invariant evaluation (node side) ---

// Queue cards: the delete ✕ must sit at a constant inset in every card's
// top-right corner (the old "centered against the name" check no longer applies
// now that names wrap below the thumbnail).
function checkCardRemovePositioned(cards) {
  if (!cards || cards.count === 0) return { pass: true, detail: "no cards" };
  const rightSpread =
    Math.max(...cards.removeInsetRights) - Math.min(...cards.removeInsetRights);
  const topSpread =
    Math.max(...cards.removeInsetTops) - Math.min(...cards.removeInsetTops);
  return {
    pass: rightSpread <= 1 && topSpread <= 1,
    rightSpread: +rightSpread.toFixed(2),
    topSpread: +topSpread.toFixed(2),
    removeInsetRights: cards.removeInsetRights,
    removeInsetTops: cards.removeInsetTops,
  };
}

// Queue cards are fixed-size tiles: one width and one height for every card, so
// a wrapping name never resizes its tile (names clamp to two lines).
function checkCardsConsistentSize(cards) {
  if (!cards || cards.count < 2) return { pass: true, detail: "fewer than 2 cards" };
  const widthSpread = Math.max(...cards.widths) - Math.min(...cards.widths);
  const heightSpread = Math.max(...cards.heights) - Math.min(...cards.heights);
  return {
    pass: widthSpread <= 1 && heightSpread <= 1,
    widthSpread: +widthSpread.toFixed(2),
    heightSpread: +heightSpread.toFixed(2),
    widths: cards.widths,
    heights: cards.heights,
  };
}

// Queue card internals: the name stays inside the card's band and the preview
// sits above it (thumbnail-card layout, not a side-by-side row).
function checkCardLayout(cards) {
  if (!cards || cards.count === 0) return { pass: true, detail: "no cards" };
  return {
    pass: cards.nameInsideCard && cards.thumbAboveName,
    nameInsideCard: cards.nameInsideCard,
    thumbAboveName: cards.thumbAboveName,
  };
}

// Queue cards must show a real preview image (the card's <img>), not the
// FileText placeholder, for every queued PDF. A placeholder regression drops
// thumbCount below the card count and fails this gate.
//
// `expectPlaceholder` marks the states whose cards have no preview pipeline at
// all (the text-shaped convert-in tools): there the placeholder is the correct
// rendering, so the invariant is skipped and evidence reports it as such
// instead of a bare `pass:false`.
function checkCardsThumbnailsPresent(cards, requireCount, expectPlaceholder = false) {
  if (!cards || cards.count === 0) {
    return requireCount
      ? { pass: false, detail: "expected cards, found none", count: 0 }
      : { pass: true, detail: "no cards" };
  }
  if (expectPlaceholder) {
    return {
      pass: cards.thumbCount === 0,
      detail: "document placeholder expected (no preview pipeline)",
      count: cards.count,
      thumbCount: cards.thumbCount,
    };
  }
  return {
    pass: cards.thumbCount === cards.count,
    count: cards.count,
    thumbCount: cards.thumbCount,
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

// Data-view rows (metadata/compare cards): the label column must start at the
// same x with the same width on every row, and each row's cells share a center
// line. The column check needs a first cell that is a label; `cellCount > 1` is
// a latent guard so a future single-cell row cannot skew the x/width spread.
function checkDataRowsAligned(rows) {
  if (!rows || rows.length === 0) return { pass: true, detail: "no data rows" };
  const labelRows = rows.filter((r) => r.cellCount > 1);
  const maxCenter = +Math.max(...rows.map((r) => r.cellCenterDelta)).toFixed(2);
  if (labelRows.length === 0) {
    // No label column to compare, but row centering still applies to every row.
    return { pass: maxCenter <= 1, maxCenterDelta: maxCenter, labelRowCount: 0 };
  }
  const xs = labelRows.map((r) => r.firstCellX);
  const ws = labelRows.map((r) => r.firstCellWidth);
  const xSpread = +(Math.max(...xs) - Math.min(...xs)).toFixed(2);
  const widthSpread = +(Math.max(...ws) - Math.min(...ws)).toFixed(2);
  return {
    pass: xSpread <= 1 && widthSpread <= 1 && maxCenter <= 1,
    xSpread,
    widthSpread,
    maxCenterDelta: maxCenter,
  };
}

// Bookmark tree (viewBookmarks): each depth level indents further right, and no
// row's title starts left of the level above it. Children share their parent's
// indent plus a constant step. Catches a flattened or double-indented tree.
function checkBookmarkTreeAligned(rows) {
  if (!rows || rows.length === 0) return { pass: true, detail: "no bookmark rows" };
  const byDepth = new Map();
  for (const r of rows) {
    const list = byDepth.get(r.depth) ?? [];
    list.push(r.x);
    byDepth.set(r.depth, list);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  // Every depth level must show exactly one indent x (rows at a level align).
  const spreads = depths.map((d) => {
    const xs = byDepth.get(d);
    return +(Math.max(...xs) - Math.min(...xs)).toFixed(2);
  });
  // Each deeper level must start strictly right of the level above.
  const steps = [];
  for (let i = 1; i < depths.length; i++) {
    const prev = byDepth.get(depths[i - 1])[0];
    const cur = byDepth.get(depths[i])[0];
    steps.push(+(cur - prev).toFixed(2));
  }
  const allIndent = steps.every((s) => s > 0);
  return {
    pass: spreads.every((s) => s <= 1) && allIndent,
    depthCount: depths.length,
    rowCount: rows.length,
    spreads,
    steps,
  };
}

// Workflow step rows: every step card shares one width and one left edge, the
// danger remove chip sits at a constant top-right inset, and each row carries
// both its tool select and JSON textarea. Catches a missing control or a card
// that drifts when a second step is added.
function checkWorkflowStepsAligned(info) {
  if (!info || info.count === 0) return { pass: true, detail: "no workflow steps" };
  const maxWidthSpread = Math.max(...info.widths) - Math.min(...info.widths);
  const maxXSpread = Math.max(...info.xs) - Math.min(...info.xs);
  const rightSpread = info.removeInsetRights.length
    ? Math.max(...info.removeInsetRights) - Math.min(...info.removeInsetRights)
    : 0;
  const topSpread = info.removeInsetTops.length
    ? Math.max(...info.removeInsetTops) - Math.min(...info.removeInsetTops)
    : 0;
  return {
    pass:
      info.complete &&
      maxWidthSpread <= 1 &&
      maxXSpread <= 1 &&
      rightSpread <= 1 &&
      topSpread <= 1,
    count: info.count,
    maxWidthSpread: +maxWidthSpread.toFixed(2),
    maxXSpread: +maxXSpread.toFixed(2),
    removeRightSpread: +rightSpread.toFixed(2),
    removeTopSpread: +topSpread.toFixed(2),
    complete: info.complete,
  };
}

// Table data view (dimensions): columns line up and cells within a row do not
// overlap (table layout is neither flex nor grid, so the generic scan misses it).
function checkDataTablesAligned(tables) {
  if (!tables || tables.length === 0) return { pass: true, detail: "no data tables" };
  const bad = tables.filter(
    (t) => t.xSpread > 1 || t.widthSpread > 1 || t.overlaps.length > 0
  );
  return {
    pass: bad.length === 0,
    xSpreads: tables.map((t) => t.xSpread),
    widthSpreads: tables.map((t) => t.widthSpread),
    overlapCount: tables.reduce((n, t) => n + t.overlaps.length, 0),
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
  "pdftoimages-form": false,
  "pdftotext-form": false,
  "svg-form": false,
  "cbz-form": false,
  "greyscale-form": false,
  "fixpagesize-form": false,
  "imagestopdf-form": false,
  "textpdf-form": false,
  "markdown-form": false,
  "csvtopdf-form": false,
  "pagenumbers-form": false,
  "watermark-text-form": false,
  "watermark-image-form": false,
  "crop-form": false,
  "headerfooter-form": false,
  "editmetadata-form": false,
  "protect-form": false,
  "unlock-form": false,
  "flatten-form": false,
  "removemetadata-form": false,
  "pdfstozip-form": false,
  "rasterize-form": false,
  "office-form": false,
  "ebook-form": false,
  "comic-form": false,
  "ocr-form": false,
  "tables-form": false,
  "pdftomarkdown-form": false,
  "prepareai-form": false,
  "attachments-add-form": false, // 2 attachment rows → enabled
  "attachments-edit-view": false, // one attachment ticked → enabled
  "bookmarks-edit-form": false,
  "toc-form": false,
  "formfill-form": false, // form loaded with a fillable field → enabled
  "formfill-filled": false, // values entered → enabled
  "formcreate-placed": false, // 3 valid rows → enabled
  "sign-draw": false, // ink points present → enabled
  "sign-type": false, // signature text present → enabled
  "stamp-form": false,
  "removeannotations-form": false, // 3 types ticked → enabled
  "sanitize-form": false,
  "bates-form": false,
  "pagelabels-form": false,
  "removeblank-form": false,
  "restrictions-form": false,
  // Phase 4 advanced/pro tools. Every form state is valid (enabled CTA) except
  // the ones whose whole point is an invalid input blocking the run.
  "pdftoa-form": false,
  "fontoutline-form": false,
  "deskew-form": false,
  "scanner-form": false,
  "colors-form": false,
  "invert-form": false,
  "posterize-form": false,
  "bgcolor-form": false,
  "textcolor-form": false,
  "overlay-form": false, // base + overlay picked → enabled
  "overlay-invalid": true, // no overlay picked → disabled
  "workflow-form": false,
  "workflow-steps": false,
  "signcert-form": false, // p12 picked → enabled
  "timestamp-form": true, // empty URL → disabled
  "validate-view": false,
};

// States that render a data card (View Metadata, Compare PDFs) / data table
// (Page Dimensions).
const DATA_CARD_STATES = new Set([
  "metadata-view",
  "compare-view",
  "attachments-add-form",
  "attachments-edit-view",
  "bookmarks-edit-form",
  "validate-view",
]);
const DATA_TABLE_STATES = new Set(["dimensions-view"]);
// States that render the bookmark outline tree (nested indent instead of a
// single label column).
const BOOKMARK_TREE_STATES = new Set(["bookmarks-view"]);
// Workflow Builder step-list geometry (one row vs two rows must stay aligned).
const WORKFLOW_STATES = new Set(["workflow-form", "workflow-steps"]);
// Editor states and which editor invariants each asserts. `page` needs a
// rasterized bitmap; `marks`/`selection`/`search`/`redact` are per-state.
const EDITOR_STATES = {
  "editor-open": { page: true, rail: true },
  "editor-annotated": { page: true, marks: true },
  "editor-selected": { page: true, marks: true, selection: true },
  "editor-search-results": { page: true, search: true },
  "editor-redact-marked": { page: true, marks: true, redact: true },
  "textedit-open": { page: true, rail: true, textEdit: true },
};

// States whose pick phase queues thumbnail cards. If the preview pipeline
// regresses to placeholders, thumbCount drops below the card count and the
// invariant fails. Every state listed here must show at least one card.
// imagestopdf-form queues pictures (image previews), the rest queue PDFs.
const IMAGE_CARD_STATES = new Set(["imagestopdf-form"]);
// The three text-shaped convert-in tools (.txt / .md / .csv) share the document
// placeholder card: none has a preview pipeline, so `cards-thumbnails-present`
// is skipped for all three identically (a real thumbnail would be a regression,
// which the per-tool getQueueThumb unit test guards instead).
const PLACEHOLDER_CARD_STATES = new Set([
  "textpdf-form",
  "markdown-form",
  "csvtopdf-form",
  "office-form",
  "ebook-form",
  "comic-form",
]);
const CARD_STATES = new Set([
  "merge-files",
  "merge-longnames",
  "merge-many",
  "merge-zhtw",
  "merge-cancelled",
  ...IMAGE_CARD_STATES,
  ...Object.keys(CTA_EXPECTATIONS).filter(
    (n) => n.endsWith("-form") && !PLACEHOLDER_CARD_STATES.has(n)
  ),
]);

function checkCtaDisabledVisible(cta, expectedDisabled) {
  if (!cta) return { pass: true, detail: "no cta" };
  const pass = expectedDisabled
    ? cta.disabled && DISABLED_CTA_BG.has(cta.background)
    : !cta.disabled && !DISABLED_CTA_BG.has(cta.background);
  return { pass, cta, expectedDisabled };
}

// Real-pdf.js state: the blob-backed fixture is 2 pages with page 2 /Rotate 90,
// so exactly 2 cells and exactly 1 rotated cell prove the real pipeline ran
// (the mock thumb count is armed to 6, so 2 cells also rules out the mock seam).
function checkRealPdfGrid(info) {
  if (!info) return { pass: false, detail: "no grid info" };
  return {
    pass: info.count === 2 && info.rotatedCount === 1,
    count: info.count,
    rotatedCount: info.rotatedCount,
  };
}

// The editor's page bitmap must actually have rasterized AND carry ink: the
// fixture has visible text, so a blank/near-blank sample means the real pdf.js
// pipeline silently failed. The ink threshold is deliberately generous (any
// pixel darker than 235 counts), so a light watermark would still pass.
const MIN_EDITOR_INK = 0.01;
function checkEditorPageRendered(info) {
  if (!info) return { pass: false, detail: "no editor page" };
  const page = info.page;
  return {
    pass:
      info.hasBitmap &&
      page.width > 0 &&
      page.height > 0 &&
      info.inkFraction !== null &&
      info.inkFraction >= MIN_EDITOR_INK,
    hasBitmap: info.hasBitmap,
    inkFraction: info.inkFraction,
    page,
  };
}

// Every non-freehand mark's body must sit inside the page box (a rect drawn on
// the page can never escape it). Freehand is an inset:0 SVG, skipped.
function checkEditorMarksInside(info) {
  if (!info) return { pass: false, detail: "no editor info" };
  const page = info.page;
  const rectMarks = info.annotations.filter((a) => a.type !== "freehand" && a.body);
  const escapes = rectMarks.filter(
    (a) =>
      a.body.x < page.x - 1 ||
      a.body.y < page.y - 1 ||
      a.body.x + a.body.width > page.x + page.width + 1 ||
      a.body.y + a.body.height > page.y + page.height + 1
  );
  return {
    pass: rectMarks.length > 0 && escapes.length === 0,
    markCount: info.annotations.length,
    rectMarkCount: rectMarks.length,
    escapes,
  };
}

// The selection outline plus eight handles must be present when a mark is
// selected, and every handle center must sit on the outline's perimeter
// (corners and edge midpoints), which catches a drifting handle.
function checkEditorSelectionHandles(info) {
  if (!info) return { pass: false, detail: "no editor info" };
  const s = info.selection;
  const handles = info.handles;
  if (!s || handles.length !== 8) {
    return { pass: false, hasSelection: Boolean(s), handleCount: handles.length };
  }
  const cx = (h) => h.x + h.width / 2;
  const cy = (h) => h.y + h.height / 2;
  // A handle is valid when its center x is on the left/right edge or the
  // horizontal midpoint, and its center y is on the top/bottom edge or the
  // vertical midpoint.
  const midX = s.x + s.width / 2;
  const midY = s.y + s.height / 2;
  const near = (a, b) => Math.abs(a - b) <= 2;
  const ok = (h) =>
    (near(cx(h), s.x) || near(cx(h), s.x + s.width) || near(cx(h), midX)) &&
    (near(cy(h), s.y) || near(cy(h), s.y + s.height) || near(cy(h), midY));
  const bad = handles.filter((h) => !ok(h));
  return {
    pass: handles.length === 8 && bad.length === 0,
    hasSelection: true,
    handleCount: handles.length,
    badHandles: bad,
  };
}

// The tool rail has one button per editor tool plus a single active tool; the
// rail must never overlap the page canvas (a negative-gap catch).
function checkEditorToolRail(info) {
  if (!info || !info.toolRail) return { pass: false, detail: "no tool rail" };
  const rail = info.toolRail;
  const page = info.page;
  const gap = page.x - (rail.x + rail.width);
  return {
    pass: info.toolCount >= 13 && info.activeTool === 1 && gap >= -1,
    toolCount: info.toolCount,
    activeTool: info.activeTool,
    railPageGap: +gap.toFixed(2),
  };
}

// Search results must render, and the pulse highlight must be on the page box.
function checkEditorSearch(info) {
  if (!info) return { pass: false, detail: "no editor info" };
  const p = info.pulse;
  const page = info.page;
  const onPage =
    p &&
    p.x >= page.x - 4 &&
    p.y >= page.y - 6 &&
    p.x + p.width <= page.x + page.width + 2 &&
    p.y + p.height <= page.y + page.height + 2;
  return {
    pass: info.results > 0 && Boolean(onPage),
    results: info.results,
    hasPulse: Boolean(p),
    pulseOnPage: Boolean(onPage),
  };
}

// The inline text editor must be open over the page with the clicked run's text
// prefilled and both actions present. The panel is also checked against the
// canvas box: it may overhang the white page (that is the point of an inline
// editor near an edge) but must never escape the visible canvas, which would
// clip the input or its buttons.
function checkEditorTextEdit(info) {
  if (!info) return { pass: false, detail: "no editor info" };
  const te = info.textEdit;
  if (!te) return { pass: false, detail: "no text-edit overlay" };
  // The canvas box was captured in editorInfo (page-side); node has no DOM.
  const canvas = info.canvas;
  const insideCanvas =
    canvas &&
    te.overlay.x >= canvas.x - 2 &&
    te.overlay.y >= canvas.y - 2 &&
    te.overlay.x + te.overlay.width <= canvas.x + canvas.width + 2 &&
    te.overlay.y + te.overlay.height <= canvas.y + canvas.height + 2;
  return {
    pass:
      Boolean(te.inputValue && te.inputValue.trim().length > 0) &&
      te.hasApply &&
      te.hasCancel &&
      Boolean(insideCanvas),
    prefilled: te.inputValue,
    hasApply: te.hasApply,
    hasCancel: te.hasCancel,
    overlay: te.overlay,
    canvas,
    insideCanvas: Boolean(insideCanvas),
  };
}

// A marked redaction must show the hatched MARKED mark AND the red warning
// line under the canvas (the warning is the user-facing half of the state).
function checkEditorRedactMarked(info) {
  if (!info) return { pass: false, detail: "no editor info" };
  return {
    pass: info.redactMark && info.redactHint,
    redactMark: info.redactMark,
    redactHint: info.redactHint,
  };
}

// Returns { invariants, evidence } for one captured state.
export function evaluateState(name, state) {
  const invariants = {
    "no-overlap": state.overlaps.length === 0,
    "form-no-overlap": checkFormNoOverlap(state).pass,
    "no-unintended-clipping": state.clipped.length === 0,
    "cards-remove-positioned": checkCardRemovePositioned(state.cardsInfo).pass,
    "cards-consistent-size": checkCardsConsistentSize(state.cardsInfo).pass,
    "cards-layout": checkCardLayout(state.cardsInfo).pass,
    "cards-thumbnails-present": null, // only asserted for states in CARD_STATES
    "grid-cells-aligned": checkGridCellsAligned(state.gridInfo).pass,
    "grid-cells-equal-size": checkGridCellsEqualSize(state.gridInfo).pass,
    "saveall-rows-centered": checkSaveAllRowsCentered(state.saveAllRows).pass,
    "data-rows-aligned": null, // only asserted for data-card states
    "data-table-aligned": null, // only asserted for table-shaped data states
    "bookmark-tree-aligned": null, // only asserted for bookmarks-view
    "workflow-steps-aligned": null, // only asserted for workflow states
    "cta-disabled-visible": null, // only asserted for states in CTA_EXPECTATIONS
    "dragover-state-visible": null, // cross-state, filled in by buildReport
    "theme-tokens-correct": null, // only meaningful for home-* states
    "grid-real-thumbs": null, // only asserted for organize-grid-real
    "editor-page-rendered": null, // only asserted for editor states
    "editor-marks-inside-page": null, // only asserted for editor mark states
    "editor-selection-handles": null, // only asserted for editor-selected
    "editor-tool-rail": null, // only asserted for editor states with a rail
    "editor-search": null, // only asserted for editor-search-results
    "editor-redact-marked": null, // only asserted for editor-redact-marked
    "editor-textedit-open": null, // only asserted for textedit-open
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
  if (DATA_CARD_STATES.has(name)) {
    invariants["data-rows-aligned"] = checkDataRowsAligned(state.dataRows).pass;
  }
  if (DATA_TABLE_STATES.has(name)) {
    invariants["data-table-aligned"] = checkDataTablesAligned(state.dataTables).pass;
  }
  if (BOOKMARK_TREE_STATES.has(name)) {
    invariants["bookmark-tree-aligned"] = checkBookmarkTreeAligned(
      state.bookmarkRows
    ).pass;
  }
  if (WORKFLOW_STATES.has(name)) {
    invariants["workflow-steps-aligned"] = checkWorkflowStepsAligned(
      state.workflowInfo
    ).pass;
  }
  if (CARD_STATES.has(name)) {
    invariants["cards-thumbnails-present"] = checkCardsThumbnailsPresent(
      state.cardsInfo,
      true
    ).pass;
  }
  const editorSpec = EDITOR_STATES[name];
  if (editorSpec) {
    invariants["editor-page-rendered"] = checkEditorPageRendered(
      state.editorInfo
    ).pass;
  }
  if (editorSpec?.marks) {
    invariants["editor-marks-inside-page"] = checkEditorMarksInside(
      state.editorInfo
    ).pass;
  }
  if (editorSpec?.selection) {
    invariants["editor-selection-handles"] = checkEditorSelectionHandles(
      state.editorInfo
    ).pass;
  }
  if (editorSpec?.rail) {
    invariants["editor-tool-rail"] = checkEditorToolRail(state.editorInfo).pass;
  }
  if (editorSpec?.search) {
    invariants["editor-search"] = checkEditorSearch(state.editorInfo).pass;
  }
  if (editorSpec?.redact) {
    invariants["editor-redact-marked"] = checkEditorRedactMarked(
      state.editorInfo
    ).pass;
  }
  if (editorSpec?.textEdit) {
    invariants["editor-textedit-open"] = checkEditorTextEdit(
      state.editorInfo
    ).pass;
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
    cardsInfo: state.cardsInfo,
    cardsRemovePositioned: checkCardRemovePositioned(state.cardsInfo),
    cardsConsistentSize: checkCardsConsistentSize(state.cardsInfo),
    cardsLayout: checkCardLayout(state.cardsInfo),
    cardsThumbnailsPresent: checkCardsThumbnailsPresent(
      state.cardsInfo,
      CARD_STATES.has(name),
      PLACEHOLDER_CARD_STATES.has(name)
    ),
    gridCellsAligned: checkGridCellsAligned(state.gridInfo),
    gridCellsEqualSize: checkGridCellsEqualSize(state.gridInfo),
    gridInfo: state.gridInfo,
    realPdfGrid: name === "organize-grid-real" ? checkRealPdfGrid(state.gridInfo) : null,
    editorInfo: state.editorInfo,
    editorPageRendered: EDITOR_STATES[name] ? checkEditorPageRendered(state.editorInfo) : null,
    editorMarksInside: EDITOR_STATES[name]?.marks ? checkEditorMarksInside(state.editorInfo) : null,
    editorSelectionHandles: EDITOR_STATES[name]?.selection ? checkEditorSelectionHandles(state.editorInfo) : null,
    editorToolRail: EDITOR_STATES[name]?.rail ? checkEditorToolRail(state.editorInfo) : null,
    editorSearch: EDITOR_STATES[name]?.search ? checkEditorSearch(state.editorInfo) : null,
    editorRedactMarked: EDITOR_STATES[name]?.redact ? checkEditorRedactMarked(state.editorInfo) : null,
    saveAllRows: state.saveAllRows,
    saveAllRowsCentered: checkSaveAllRowsCentered(state.saveAllRows),
    saveAllRowCount: state.saveAllRowCount,
    dataRows: state.dataRows,
    dataRowsAligned: checkDataRowsAligned(state.dataRows),
    dataTables: state.dataTables,
    dataTablesAligned: checkDataTablesAligned(state.dataTables),
    bookmarkRows: state.bookmarkRows,
    bookmarkTreeAligned: checkBookmarkTreeAligned(state.bookmarkRows),
    workflowInfo: state.workflowInfo,
    workflowStepsAligned: checkWorkflowStepsAligned(state.workflowInfo),
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
