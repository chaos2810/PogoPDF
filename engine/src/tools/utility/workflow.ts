import { TOOL_IDS, WorkflowInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import type { ToolEntry, ToolRegistry } from "../registry";
import { assertNotCancelled, invalidInput } from "../organize/organize";

/** Marks an input field that should receive the previous step's output path. */
const PREVIOUS = "$previous";

/**
 * A visual pipeline: registered tools run sequentially, each consuming the
 * previous step's output. A step's `filePath` or `baseFilePath` may be the
 * literal "$previous"; it is replaced by the prior step's output path.
 *
 * Output threading contract: step 1 cannot use "$previous" (INVALID_INPUT); a
 * "$previous" reference after a step that returned data or a list of files
 * (anything other than a single string path) is INVALID_INPUT, naming the
 * referencing step. Nested workflows are rejected. The final step must return a
 * single output path (the workflow result); a data-returning final step is
 * INVALID_INPUT. A step's typed failure aborts the whole workflow (the job
 * wrapper discards the whole outDir, so there is no partial cleanup to do here).
 *
 * Progress is reported once per completed step: percent = done/total and stage
 * = the step's toolId. Cancellation is checked between steps; a tool's own
 * inner progress is suppressed so the workflow's percent stays step-based.
 */
export async function runWorkflow(
  input: unknown,
  ctx: RpcCtx,
  outDir: string,
  tools: ToolRegistry
): Promise<string> {
  const { steps } = WorkflowInputSchema.parse(input);
  assertNotCancelled(ctx);

  let previousPath: string | undefined;
  // The child ctx shares cancellation but silences inner progress: the workflow
  // owns the progress signal (percent is step-based, not page-based).
  const childCtx: RpcCtx = { cancelled: ctx.cancelled, notifyProgress: () => {} };

  for (let i = 0; i < steps.length; i++) {
    assertNotCancelled(ctx);
    const step = steps[i];
    const stepNo = i + 1;

    if (step.toolId === TOOL_IDS.workflow) {
      throw invalidInput(
        `Step ${stepNo}: nested workflows are not allowed (toolId "workflow")`
      );
    }

    const entry: ToolEntry | undefined = tools.get(step.toolId);
    if (!entry) {
      throw invalidInput(`Step ${stepNo}: unknown tool "${step.toolId}"`);
    }

    // Thread the previous output into the step's input. References are detected
    // before validation so a dangling reference names the right step.
    const stepInput: Record<string, unknown> = { ...step.input };
    for (const field of ["filePath", "baseFilePath"]) {
      if (stepInput[field] === PREVIOUS) {
        if (i === 0) {
          throw invalidInput(`Step 1: "$previous" has no preceding step output`);
        }
        if (previousPath === undefined) {
          throw invalidInput(
            `Step ${stepNo}: "$previous" is unavailable because step ${i} did not produce a file output`
          );
        }
        stepInput[field] = previousPath;
      }
    }

    const parsed = entry.schema.safeParse(stepInput);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
      throw invalidInput(
        `Step ${stepNo} ("${step.toolId}") has invalid input: ${where}${issue.message}`
      );
    }

    let result: string | string[] | object;
    try {
      result = await entry.run(parsed.data, childCtx, outDir);
    } catch (e) {
      // Abort the whole workflow, naming the failing step. A typed error keeps
      // its code; an untyped failure is a genuine bug, so surface it as an
      // internal error rather than mislabeling it INVALID_INPUT.
      const base = e instanceof Error ? e.message : String(e);
      const typed = (e as { code?: number })?.code;
      if (typed !== undefined) {
        throw Object.assign(
          new Error(`Step ${stepNo} ("${step.toolId}"): ${base}`),
          { code: typed }
        );
      }
      throw Object.assign(
        new Error(`Step ${stepNo} ("${step.toolId}") failed: ${base}`),
        { code: -32000 }
      );
    }
    previousPath = typeof result === "string" ? result : undefined;

    if (i === steps.length - 1 && typeof result !== "string") {
      throw invalidInput(
        `Step ${stepNo} ("${step.toolId}") must return a file output to be a workflow result`
      );
    }

    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((stepNo / steps.length) * 100),
      stage: step.toolId,
      pagesDone: stepNo,
    });
  }

  return previousPath as string;
}
