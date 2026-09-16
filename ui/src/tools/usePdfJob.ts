import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { cancelJob, onProgress, startJob } from "../app/rpc";

export type PdfJobPhase = "pick" | "running" | "done" | "data" | "error";

type SettleTarget = "done" | "data";

/**
 * Shared machinery for tool screens: drag-drop intake, progress subscription,
 * job start/cancel, and the pick/running/done/error phase machine. The two
 * shells (FileToolScreen, DataToolScreen) own their own chrome and diff only in
 * how they settle a result and how they present the pick/done phases.
 */
export function usePdfJob(
  toolId: string,
  buildInput: (files: string[]) => unknown,
  opts: { multiple?: boolean } = {}
) {
  const multiple = opts.multiple ?? false;
  const [files, setFiles] = useState<string[]>([]);
  const [phase, setPhase] = useState<PdfJobPhase>("pick");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string>("");
  const [errorCode, setErrorCode] = useState<number | undefined>(undefined);
  const [data, setData] = useState<unknown>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  // Set while a job is in flight so the running card can cancel it.
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => onProgress((p) => setPercent(p.percent)), []);

  useEffect(() => {
    const win = getCurrentWindow();
    const isPdf = (p: string) => p.toLowerCase().endsWith(".pdf");
    const addFiles = (paths: string[]) => {
      const pdfs = paths.filter(isPdf);
      if (pdfs.length === 0) return;
      setFiles((prev) =>
        multiple ? [...new Set([...prev, ...pdfs])] : [pdfs[0]]
      );
    };
    const unEnter = win.listen<{ paths: string[] }>("tauri://drag-enter", (e) => {
      if (e.payload.paths.some(isPdf)) setIsDragActive(true);
    });
    const unOver = win.listen("tauri://drag-over", () => setIsDragActive(true));
    const unLeave = win.listen("tauri://drag-leave", () => setIsDragActive(false));
    const unDrop = win.listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
      setIsDragActive(false);
      addFiles(e.payload.paths);
    });
    return () => {
      void unEnter.then((f) => f());
      void unOver.then((f) => f());
      void unLeave.then((f) => f());
      void unDrop.then((f) => f());
    };
  }, []);

  const reset = () => {
    setFiles([]);
    setPhase("pick");
    setError("");
    setErrorCode(undefined);
    setData(null);
    jobIdRef.current = null;
  };

  const cancel = async () => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    try {
      await cancelJob(jobId);
    } catch {
      /* cancel is best-effort; the job result still settles the UI */
    }
  };

  /**
   * Start a job. `settle` receives the raw engine result and decides how to
   * present it (file bar vs data card); `onError` overrides an error result
   * when a shell needs a different message.
   */
  const run = async (
    settle: (result: Record<string, unknown>) => SettleTarget,
    onError?: (e: unknown) => string
  ): Promise<void> => {
    if (files.length === 0) return;
    setPhase("running");
    setPercent(0);
    try {
      const result = await startJob(toolId, buildInput(files), {
        onJobId: (id) => {
          jobIdRef.current = id;
        },
      });
      const target = settle(result as unknown as Record<string, unknown>);
      setPhase(target);
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === TOOL_ERROR_CODES.CANCELLED) {
        // Cancel is a user action, not a failure: return to the pick phase.
        setPhase("pick");
      } else {
        setError(onError ? onError(e) : e instanceof Error ? e.message : String(e));
        setErrorCode(code);
        setPhase("error");
      }
    } finally {
      jobIdRef.current = null;
    }
  };

  return {
    files,
    setFiles,
    phase,
    setPhase,
    percent,
    error,
    errorCode,
    data,
    setData,
    isDragActive,
    reset,
    cancel,
    run,
  };
}
