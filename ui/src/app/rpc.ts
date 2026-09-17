import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DataResultSchema,
  JobResultSchema,
  MultiFileResultSchema,
  type DataResult,
  type JobResult,
  type MultiFileResult,
} from "@pogopdf/contracts";

export type ProgressPayload = {
  jobId: string;
  percent: number;
  stage: string;
  pagesDone: number;
};

export async function callEngine(method: string, params?: unknown): Promise<unknown> {
  try {
    return await invoke("rpc_call", { method, params: params ?? {} });
  } catch (raw) {
    const err = parseEngineError(raw);
    throw err;
  }
}

// rpc_call rejects with the engine error object as a JSON string; surface
// {code,message} as an Error subclass when parseable, else keep the raw value.
function parseEngineError(raw: unknown): Error {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as { code?: number; message?: string };
      if (typeof parsed?.message === "string") {
        return Object.assign(new Error(parsed.message), { code: parsed.code });
      }
    } catch {
      /* not JSON - fall through */
    }
    return new Error(raw);
  }
  if (raw instanceof Error) return raw;
  return new Error(String(raw));
}

// Multi-output tools (split) return {outputPaths}; data tools (viewMetadata,
// pageDimensions) return {data}; everything else returns {outputPath}.
// Discriminate on the key before validating. `onJobId` fires with the generated
// id before the RPC is awaited, so callers can offer Cancel.
export async function startJob(
  toolId: string,
  input: unknown,
  opts?: { onJobId?: (jobId: string) => void }
): Promise<JobResult | MultiFileResult | DataResult> {
  const jobId = crypto.randomUUID();
  opts?.onJobId?.(jobId);
  const result = await callEngine("job.start", { jobId, toolId, input });
  if (result && typeof result === "object" && "outputPaths" in result) {
    return MultiFileResultSchema.parse(result);
  }
  if (result && typeof result === "object" && "data" in result) {
    return DataResultSchema.parse(result);
  }
  return JobResultSchema.parse(result);
}

export async function cancelJob(jobId: string): Promise<void> {
  await callEngine("job.cancel", { jobId });
}

export function onProgress(cb: (p: ProgressPayload) => void): () => void {
  const un = listen<{ jsonrpc: "2.0"; method: string; params: ProgressPayload }>(
    "engine://progress",
    (e) => cb(e.payload.params)
  );
  return () => {
    void un.then((f) => f());
  };
}

/**
 * Generalized picker: `filter` is a dialog preset ("pdf" default, "images") or a
 * comma-separated extension list. `filter` is always sent (as a real value or
 * null) so the Rust command's Option<String> arg is never a missing key.
 */
export async function pickFiles(multiple: boolean, filter?: string): Promise<string[]> {
  return invoke("dialog_open_pdf", { multiple, filter: filter ?? null });
}

export async function pickPdfs(multiple: boolean): Promise<string[]> {
  return pickFiles(multiple, "pdf");
}

export async function pickImages(multiple: boolean): Promise<string[]> {
  return pickFiles(multiple, "images");
}

export async function saveAsPdf(defaultName: string): Promise<string | null> {
  return invoke("dialog_save", { defaultName });
}

export async function pickFolder(): Promise<string | null> {
  return invoke("dialog_pick_folder");
}

export async function revealInExplorer(path: string): Promise<void> {
  return invoke("reveal", { path });
}
