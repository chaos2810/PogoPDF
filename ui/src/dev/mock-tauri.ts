// Dev-only Tauri host mock. Loaded from main.tsx ONLY when import.meta.env.DEV
// and the URL has ?mock=1, so the production bundle never references it.
//
// Interception point: @tauri-apps/api reads window.__TAURI_INTERNALS__ at call
// time (never at module load), so installing a fake host object before the app
// renders is enough. We answer invoke() and capture plugin:event|listen
// callbacks keyed by event name, then dispatch canned events into them.

export const POGOPDF_MOCK_MODE = "POGOPDF_MOCK_MODE";

type EventHandler = (e: { event: string; id: number; payload: unknown }) => void;
type JobMode = "auto" | "hold" | "error";

const callbacks = new Map<number, (payload: unknown) => void>();
const listeners = new Map<string, Map<number, EventHandler>>();
let nextId = 1;

const state = {
  files: [] as string[],
  jobMode: "auto" as JobMode,
  jobError: "The PDF appears to be corrupt",
  // Settles the held job.start promise (reject on cancel, resolve otherwise).
  resolveJob: null as null | ((settle: "resolve" | "cancel") => void),
  // Readable path -> blob URL, set by __mockBlobPath so convertFileSrc can
  // resolve the blob behind a friendly file name (real pdf.js state).
  blobFiles: {} as Record<string, string>,
  outputPath: "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\merged.pdf",
  outputPaths: null as string[] | null,
  dataResults: {} as Record<string, unknown>,
  folder: "C:\\Users\\demo\\Downloads\\split-out",
  copyFailNames: new Set<string>(),
  thumbCount: 6,
};

// Canvas-drawn fake page images so organize states render without a real PDF.
function makeFakeThumb(i: number, w = 160, h = 210) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.fillStyle = "#334155";
  ctx.font = "bold 56px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(i + 1), w / 2, h / 2);
  return { index: i, dataUrl: canvas.toDataURL("image/png"), width: w, height: h, rotate: 0 };
}

// Canned data results so the data-view screens render without a real engine.
const DEFAULT_DATA_RESULTS: Record<string, unknown> = {
  viewMetadata: {
    title: "Quarterly Report",
    author: "Ada Lovelace",
    subject: "Revenue reconciliation",
    keywords: "finance, report, 2024",
    creator: "LibreOffice Writer",
    producer: "pdf-lib",
    creationDate: "2024-07-01T09:30:00.000Z",
    modificationDate: "2024-07-03T14:05:00.000Z",
    pageCount: 12,
    fileSizeBytes: 2489344,
  },
  pageDimensions: {
    pages: [
      { widthPt: 595.28, heightPt: 841.89, widthMm: 210, heightMm: 297, orientation: "portrait", rotation: 0 },
      { widthPt: 595.28, heightPt: 841.89, widthMm: 210, heightMm: 297, orientation: "portrait", rotation: 0 },
      { widthPt: 841.89, heightPt: 595.28, widthMm: 297, heightMm: 210, orientation: "landscape", rotation: 90 },
      { widthPt: 612, heightPt: 792, widthMm: 215.9, heightMm: 279.4, orientation: "portrait", rotation: 0 },
      { widthPt: 419.53, heightPt: 595.28, widthMm: 148, heightMm: 210, orientation: "portrait", rotation: 0 },
    ],
  },
};

function addListener(event: string, id: number) {
  const cb = callbacks.get(id);
  if (!cb) return;
  const byId = listeners.get(event) ?? new Map<number, EventHandler>();
  byId.set(id, ((e) => cb(e)) as EventHandler);
  listeners.set(event, byId);
}

function removeListener(event: string, id: number) {
  listeners.get(event)?.delete(id);
}

function emit(event: string, payload: unknown) {
  for (const [id, handler] of listeners.get(event) ?? []) {
    handler({ event, id, payload });
  }
}

function rpc(method: string, params: { jobId?: string; toolId?: string } = {}): unknown {
  if (method === "engine.ping") return { pong: true };
  if (method === "file.copy") {
    const dest = String((params as { dest?: string }).dest ?? "");
    const name = dest.split(/[\\/]/).pop() ?? "";
    if (state.copyFailNames.has(name)) {
      return Promise.reject(JSON.stringify({ code: -32000, message: `cannot copy ${name}` }));
    }
    return { copied: true };
  }
  if (method === "job.start") {
    if (state.jobMode === "error") {
      return Promise.reject(JSON.stringify({ code: -32003, message: state.jobError }));
    }
    const toolId = params.toolId ?? "";
    // Data tools (viewMetadata, pageDimensions) return {data: …} under the
    // canned payload set by __mockSetDataResult / the built-in defaults.
    const data =
      state.dataResults[toolId] ?? (toolId in DEFAULT_DATA_RESULTS ? DEFAULT_DATA_RESULTS[toolId] : undefined);
    const result =
      data !== undefined
        ? { jobId: params.jobId, data }
        : state.outputPaths
          ? { jobId: params.jobId, outputPaths: state.outputPaths.slice() }
          : { jobId: params.jobId, outputPath: state.outputPath };
    if (state.jobMode === "hold") {
      return new Promise((resolve, reject) => {
        state.resolveJob = (settle) => {
          if (settle === "cancel") {
            reject(JSON.stringify({ code: -32005, message: "Job cancelled" }));
          } else {
            resolve(result);
          }
        };
      });
    }
    return result;
  }
  if (method === "job.cancel") {
    if (state.resolveJob) {
      const settle = state.resolveJob;
      state.resolveJob = null;
      settle("cancel");
    }
    return { cancelled: true };
  }
  return null;
}

async function mockInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (cmd === "rpc_call") return rpc(String(args.method), (args.params ?? {}) as { jobId?: string });
  if (cmd === "dialog_open_pdf") return state.files.slice();
  if (cmd === "dialog_save") return "C:\\Users\\demo\\Downloads\\merged.pdf";
  if (cmd === "dialog_pick_folder") return state.folder;
  if (cmd === "reveal") return null;
  if (cmd === "plugin:event|listen") {
    addListener(String(args.event), Number(args.handler));
    return Number(args.handler);
  }
  if (cmd === "plugin:event|unlisten") {
    removeListener(String(args.event), Number(args.eventId));
    return null;
  }
  return null;
}

type MockWindow = Record<string, unknown> & { isTauri?: boolean };
const w = window as unknown as MockWindow;

w.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" } },
  transformCallback(cb: (payload: unknown) => void) {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  },
  unregisterCallback(id: number) {
    callbacks.delete(id);
  },
  invoke: mockInvoke,
  convertFileSrc: (p: string) => state.blobFiles[p] ?? p,
  plugins: { path: { sep: "\\", delimiter: ";" } },
};
w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: removeListener };
w.isTauri = true;

// --- Control surface used by ui/scripts/screenshots.mjs ---
w.__mockSetFiles = (paths: string[]) => {
  state.files = paths.slice();
};

w.__mockProgress = (payload: Record<string, unknown> = {}) => {
  emit("engine://progress", {
    jsonrpc: "2.0",
    method: "progress",
    params: { jobId: "mock-job", percent: 0, stage: "merging", pagesDone: 0, ...payload },
  });
};

w.__mockDragEnter = (paths: string[]) =>
  emit("tauri://drag-enter", { paths, position: { x: 0, y: 0 } });
w.__mockDragLeave = () => emit("tauri://drag-leave", {});
w.__mockDrop = (paths: string[]) => emit("tauri://drag-drop", { paths, position: { x: 0, y: 0 } });

w.__mockJobControl = (mode: JobMode, message?: string) => {
  state.jobMode = mode;
  if (message) state.jobError = message;
};
// Real-pdf.js state: build a blob URL from raw PDF bytes and register it under
// `name`, then return `name` as a readable filesystem-style path. The screen
// loads the path (which, unlike drop, is not filtered on .pdf) and displays
// name; convertFileSrc maps name back to the blob URL for pdf.js.
w.__mockBlobPath = (bytes: number[], name = "real-sample.pdf") => {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/pdf" })
  );
  state.blobFiles[name] = url;
  return name;
};
w.__mockResolveJob = () => {
  const settle = state.resolveJob;
  state.resolveJob = null;
  settle?.("resolve");
};

// Multi-output (split) seam: set the job result shape and the folder the
// picker returns; fail a specific output basename to exercise the error row.
w.__mockSetOutputPaths = (paths: string[] | null) => {
  state.outputPaths = paths ? paths.slice() : null;
};
// Canned job.start data result per toolId (viewMetadata, pageDimensions).
w.__mockSetDataResult = (toolId: string, data: unknown) => {
  if (data === null) delete state.dataResults[toolId];
  else state.dataResults[toolId] = data;
};
w.__mockSetFolder = (path: string) => {
  state.folder = path;
};
w.__mockCopyFail = (name: string, fail = true) => {
  if (fail) state.copyFailNames.add(name);
  else state.copyFailNames.delete(name);
};

// Thumbnail seam for the organize grid. real pdfthumbs.ts checks for this hook;
// when present it replaces pdf.js for filesystem paths, so screenshots need no
// real PDF. A blob:/data: path is passed through (returns null) so the real
// pdf.js pipeline still runs for the blob-backed "real PDF" state.
// Called with a number it arms how many fake pages the next load returns (the
// harness uses this); called with a path it returns the armed pages.
w.__mockPdfThumbs = (arg?: number | string) => {
  if (typeof arg === "number") {
    state.thumbCount = arg;
    return;
  }
  if (typeof arg === "string" && /^(blob:|data:)/i.test(arg)) return null;
  // A name registered by __mockBlobPath must run the real pdf.js pipeline too.
  if (typeof arg === "string" && arg in state.blobFiles) return null;
  return Array.from({ length: state.thumbCount }, (_, i) => makeFakeThumb(i));
};
