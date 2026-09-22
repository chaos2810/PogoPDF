import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { encryptedPdfBytes, fixtureDir, makePdf } from "../../testing/fixtures";
import { writeFileSync } from "node:fs";
import { registerTools } from "../registry";
import type { ToolRegistry } from "../registry";
import { runWorkflow } from "./workflow";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-workflow-"));
}

function registry(): ToolRegistry {
  const tools: ToolRegistry = new Map();
  registerTools(tools);
  return tools;
}

describe("runWorkflow", () => {
  let dir: string;
  let tools: ToolRegistry;
  let one: string;
  let two: string;

  beforeAll(async () => {
    dir = fixtureDir("workflow");
    tools = registry();
    one = await makePdf(join(dir, "wf-one.pdf"), 1);
    two = await makePdf(join(dir, "wf-two.pdf"), 2);
  });

  it("chains merge then rotate, threading $previous end-to-end", async () => {
    const out = await runWorkflow(
      {
        steps: [
          { toolId: "merge", input: { filePaths: [one, two] } },
          { toolId: "rotate", input: { filePath: "$previous", angle: 90 } },
        ],
      },
      ctx,
      outDir(),
      tools
    );

    // The result is the final step's output (rotated.pdf), a valid 3-page PDF.
    expect(out.endsWith("rotated.pdf")).toBe(true);
    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPageCount()).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(doc.getPage(i).getRotation().angle).toBe(90);
    }
  });

  it("reports progress per step with the toolId as the stage", async () => {
    const events: Array<{ percent: number; stage: string }> = [];
    await runWorkflow(
      {
        steps: [
          { toolId: "merge", input: { filePaths: [one, two] } },
          { toolId: "rotate", input: { filePath: "$previous", angle: 180 } },
        ],
      },
      {
        ...ctx,
        notifyProgress: (p) => events.push({ percent: p.percent, stage: p.stage }),
      },
      outDir(),
      tools
    );
    expect(events).toEqual([
      { percent: 50, stage: "merge" },
      { percent: 100, stage: "rotate" },
    ]);
  });

  it("allows a data tool mid-chain when nothing references $previous", async () => {
    // viewMetadata returns data; rotate after it must use a real filePath.
    const out = await runWorkflow(
      {
        steps: [
          { toolId: "viewMetadata", input: { filePath: one } },
          { toolId: "rotate", input: { filePath: one, angle: 90 } },
        ],
      },
      ctx,
      outDir(),
      tools
    );
    expect(out.endsWith("rotated.pdf")).toBe(true);
    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPageCount()).toBe(1);
  });

  it("rejects $previous at step 1 with INVALID_INPUT", async () => {
    await expect(
      runWorkflow(
        { steps: [{ toolId: "rotate", input: { filePath: "$previous", angle: 90 } }] },
        ctx,
        outDir(),
        tools
      )
    ).rejects.toMatchObject({
      code: -32001,
      message: expect.stringContaining("Step 1"),
    });
  });

  it("rejects $previous after a step that returned data, naming the step", async () => {
    await expect(
      runWorkflow(
        {
          steps: [
            { toolId: "viewMetadata", input: { filePath: one } },
            { toolId: "rotate", input: { filePath: "$previous", angle: 90 } },
          ],
        },
        ctx,
        outDir(),
        tools
      )
    ).rejects.toMatchObject({
      code: -32001,
      message: expect.stringContaining("Step 2"),
    });
  });

  it("rejects a nested workflow step via the recursion guard", async () => {
    await expect(
      runWorkflow(
        {
          steps: [
            { toolId: "merge", input: { filePaths: [one, two] } },
            { toolId: "workflow", input: { steps: [{ toolId: "rotate", input: { filePath: "$previous", angle: 90 } }] } },
          ],
        },
        ctx,
        outDir(),
        tools
      )
    ).rejects.toMatchObject({
      code: -32001,
      message: expect.stringContaining("nested"),
    });
  });

  it("rejects an unknown toolId", async () => {
    await expect(
      runWorkflow(
        { steps: [{ toolId: "nope", input: {} }] },
        ctx,
        outDir(),
        tools
      )
    ).rejects.toMatchObject({ code: -32001, message: expect.stringContaining("nope") });
  });

  it("rejects a step whose input fails its own schema", async () => {
    await expect(
      runWorkflow(
        { steps: [{ toolId: "rotate", input: { filePath: one, angle: 45 } }] },
        ctx,
        outDir(),
        tools
      )
    ).rejects.toMatchObject({ code: -32001, message: expect.stringContaining("Step 1") });
  });

  it("aborts with the failing step's typed error and names the step", async () => {
    const bad = join(dir, "wf-bad.pdf");
    writeFileSync(bad, encryptedPdfBytes());

    await expect(
      runWorkflow(
        {
          steps: [
            { toolId: "merge", input: { filePaths: [one, two] } },
            { toolId: "rotate", input: { filePath: bad, angle: 90 } },
          ],
        },
        ctx,
        outDir(),
        tools
      )
    ).rejects.toMatchObject({
      code: -32002,
      message: expect.stringContaining("Step 2"),
    });
  });

  it("rejects a final step that returns data rather than a file", async () => {
    await expect(
      runWorkflow(
        { steps: [{ toolId: "viewMetadata", input: { filePath: one } }] },
        ctx,
        outDir(),
        tools
      )
    ).rejects.toMatchObject({ code: -32001, message: expect.stringContaining("Step 1") });
  });

  it("rejects an empty steps array via the schema", async () => {
    await expect(runWorkflow({ steps: [] }, ctx, outDir(), tools)).rejects.toThrow();
  });

  it("cancels between steps when the flag is raised after step 1", async () => {
    let cancelled = false;
    await expect(
      runWorkflow(
        {
          steps: [
            { toolId: "merge", input: { filePaths: [one, two] } },
            { toolId: "rotate", input: { filePath: "$previous", angle: 90 } },
          ],
        },
        {
          ...ctx,
          cancelled: () => cancelled,
          notifyProgress: () => {
            cancelled = true;
          },
        },
        outDir(),
        tools
      )
    ).rejects.toMatchObject({ code: -32005 });
  });
});
