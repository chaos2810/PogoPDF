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
  resolveJob: null as null | (() => void),
  outputPath: "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\merged.pdf",
  outputPaths: null as string[] | null,
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
  return { index: i, dataUrl: canvas.toDataURL("image/png"), width: w, height: h };
}

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

function rpc(method: string, params: { jobId?: string } = {}): unknown {
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
    const result = state.outputPaths
      ? { jobId: params.jobId, outputPaths: state.outputPaths.slice() }
      : { jobId: params.jobId, outputPath: state.outputPath };
    if (state.jobMode === "hold") {
      return new Promise((resolve) => {
        state.resolveJob = () => resolve(result);
      });
    }
    return result;
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
  convertFileSrc: (p: string) => p,
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
w.__mockResolveJob = () => {
  state.resolveJob?.();
  state.resolveJob = null;
};

// Multi-output (split) seam: set the job result shape and the folder the
// picker returns; fail a specific output basename to exercise the error row.
w.__mockSetOutputPaths = (paths: string[] | null) => {
  state.outputPaths = paths ? paths.slice() : null;
};
w.__mockSetFolder = (path: string) => {
  state.folder = path;
};
w.__mockCopyFail = (name: string, fail = true) => {
  if (fail) state.copyFailNames.add(name);
  else state.copyFailNames.delete(name);
};

// Thumbnail seam for the organize grid. real pdfthumbs.ts checks for this hook;
// when present it replaces pdf.js entirely, so screenshots need no real PDF.
// Called with a count it arms how many fake pages the next load returns (the
// harness uses this); called with no args it returns the armed pages.
w.__mockPdfThumbs = (count?: number) => {
  if (typeof count === "number") state.thumbCount = count;
  return Array.from({ length: state.thumbCount }, (_, i) => makeFakeThumb(i));
};
