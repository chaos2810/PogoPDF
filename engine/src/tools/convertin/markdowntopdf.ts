import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { marked } from "marked";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { MarkdownToPdfInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { buildPdf, readTextFile } from "../../textpdf/docbuilder";

const LIST_INDENT = 18;
const QUOTE_INDENT = 18;
const CODE_SIZE_FACTOR = 0.9;
const HEADING_SCALE: Record<string, number> = { h1: 1.7, h2: 1.4, h3: 1.2 };

/** Flatten a DOM subtree to text, turning <br> into newlines (v1 drops inline styling). */
function inlineText(node: Node, skip = new Set<string>()): string {
  if (node.nodeType === 3) return node.nodeValue ?? "";
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  if (skip.has(el.tagName.toLowerCase())) return "";
  if (el.tagName.toLowerCase() === "br") return "\n";
  let out = "";
  for (const child of Array.from(node.childNodes)) out += inlineText(child, skip);
  return out;
}

function sanitize(markdown: string): Document {
  const window = new JSDOM("").window;
  // jsdom's DOMWindow satisfies DOMPurify's WindowLike contract but its types
  // do not line up directly (the structural Pick<> is stricter than Window).
  const DOMPurify = createDOMPurify(
    window as unknown as Parameters<typeof createDOMPurify>[0]
  );
  const html = marked.parse(markdown, { gfm: true, async: false }) as string;
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  return new JSDOM(clean).window.document;
}

export async function runMarkdownToPdf(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, fontSize, margins } = MarkdownToPdfInputSchema.parse(input);
  assertNotCancelled(ctx);

  const markdown = await readTextFile(filePath);
  const body = sanitize(markdown).body;

  const bytes = await buildPdf({ fontSize, margins }, (doc) => {
    const left = doc.page.margins.left;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const paragraph = (text: string, opts: { indent?: number; color?: string } = {}) => {
      if (!text.trim()) return;
      doc.font("Helvetica").fontSize(fontSize).fillColor(opts.color ?? "black");
      doc.text(text, { indent: opts.indent ?? 0, paragraphGap: 6 });
    };

    const codeBlock = (text: string) => {
      const size = fontSize * CODE_SIZE_FACTOR;
      doc.font("Courier").fontSize(size);
      const lineHeight = doc.currentLineHeight();
      for (const line of text.replace(/\n$/, "").split("\n")) {
        // Manual y placement bypasses pdfkit's flow, so break pages here.
        if (doc.y + lineHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
        }
        const y = doc.y;
        doc.rect(left, y - 1, contentWidth, lineHeight + 2).fill("#f2f2f2");
        doc.fillColor("#444444").text(line || " ", left + 4, y, { lineBreak: false });
        doc.y = y + lineHeight;
      }
      doc.moveDown();
    };

    const heading = (level: string, text: string) => {
      doc.moveDown(0.5);
      doc
        .font("Helvetica-Bold")
        .fontSize(fontSize * (HEADING_SCALE[level] ?? 1))
        .fillColor("black")
        .text(text, { paragraphGap: 4 });
      doc.moveDown(0.3);
    };

    const list = (el: Element, ordered: boolean) => {
      let n = 1;
      for (const li of Array.from(el.children)) {
        if (li.tagName.toLowerCase() !== "li") continue;
        const marker = ordered ? `${n++}. ` : "• ";
        paragraph(marker + inlineText(li, new Set(["ul", "ol"])).trim(), {
          indent: LIST_INDENT,
        });
      }
    };

    const blockquote = (el: Element) => {
      paragraph(inlineText(el).trim(), { indent: QUOTE_INDENT, color: "#666666" });
    };

    const table = (el: Element) => {
      for (const tr of Array.from(el.querySelectorAll("tr"))) {
        const cells = Array.from(tr.children).map((c) => inlineText(c).trim());
        paragraph(cells.join(" | "));
      }
    };

    const hr = () => {
      doc.moveDown(0.5);
      const y = doc.y;
      doc
        .moveTo(left, y)
        .lineTo(left + contentWidth, y)
        .strokeColor("#999999")
        .stroke();
      doc.moveDown(0.5);
    };

    for (const el of Array.from(body.children)) {
      const tag = el.tagName.toLowerCase();
      switch (tag) {
        case "h1":
        case "h2":
        case "h3":
          heading(tag, inlineText(el).trim());
          break;
        case "p":
          paragraph(inlineText(el).trim());
          break;
        case "ul":
          list(el, false);
          break;
        case "ol":
          list(el, true);
          break;
        case "pre":
          codeBlock(el.textContent ?? "");
          break;
        case "blockquote":
          blockquote(el);
          break;
        case "table":
          table(el);
          break;
        case "hr":
          hr();
          break;
        default:
          paragraph(inlineText(el).trim());
      }
    }
  });

  const outPath = join(outDir, `${basename(filePath, extname(filePath))}.pdf`);
  await writeFile(outPath, bytes);
  return outPath;
}
