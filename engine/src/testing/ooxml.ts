import JSZip from "jszip";
import { writeFileSync } from "node:fs";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_DOC_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

/**
 * Minimal hand-built OOXML / ODF fixtures. Each file is a valid package that
 * LibreOffice opens, with one piece of identifiable text. They are deliberately
 * tiny: a .docx is a zip of three XML parts, and building them here avoids
 * adding officegen/docx/exceljs as test-only dependencies. Verified against
 * LibreOffice 26.2 headless (see office.test.ts).
 */
async function writeZip(path: string, build: (zip: JSZip) => void): Promise<string> {
  const zip = new JSZip();
  build(zip);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(path, bytes);
  return path;
}

function contentTypes(overrides: Array<[string, string]>): string {
  const parts = overrides
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join("");
  return (
    XML_HEADER +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    parts +
    `</Types>`
  );
}

function rootRels(target: string): string {
  return (
    XML_HEADER +
    `<Relationships xmlns="${RELS_NS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="${target}"/>` +
    `</Relationships>`
  );
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Word document with one paragraph holding `text`. */
export async function makeDocx(path: string, text: string): Promise<string> {
  const doc =
    XML_HEADER +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body><w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:body>` +
    `</w:document>`;
  return writeZip(path, (zip) => {
    zip.file(
      "[Content_Types].xml",
      contentTypes([
        [
          "/word/document.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ],
      ])
    );
    zip.file("_rels/.rels", rootRels("word/document.xml"));
    zip.file("word/document.xml", doc);
  });
}

/** One-sheet workbook with `cell` in A1. */
export async function makeXlsx(path: string, cell: string): Promise<string> {
  const workbook =
    XML_HEADER +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels =
    XML_HEADER +
    `<Relationships xmlns="${RELS_NS}">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
    `Target="worksheets/sheet1.xml"/></Relationships>`;
  const sheet =
    XML_HEADER +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData><row r="1"><c r="A1" t="n"><v>${escapeXml(cell)}</v></c></row></sheetData>` +
    `</worksheet>`;
  return writeZip(path, (zip) => {
    zip.file(
      "[Content_Types].xml",
      contentTypes([
        [
          "/xl/workbook.xml",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        ],
        [
          "/xl/worksheets/sheet1.xml",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
        ],
      ])
    );
    zip.file("_rels/.rels", rootRels("xl/workbook.xml"));
    zip.file("xl/workbook.xml", workbook);
    zip.file("xl/_rels/workbook.xml.rels", workbookRels);
    zip.file("xl/worksheets/sheet1.xml", sheet);
  });
}

/** Presentation with a single slide whose title placeholder holds `title`. */
export async function makePptx(path: string, title: string): Promise<string> {
  const presentation =
    XML_HEADER +
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>` +
    `<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/></p:presentation>`;
  const presentationRels =
    XML_HEADER +
    `<Relationships xmlns="${RELS_NS}">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" ` +
    `Target="slides/slide1.xml"/></Relationships>`;
  const slide =
    XML_HEADER +
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>` +
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
    // A placeholder with empty spPr has no geometry, and LibreOffice then drops
    // the title from the rendered slide (verified: extracted text was empty).
    // An explicit xfrm makes the title visible.
    `<p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>` +
    `<a:p><a:r><a:rPr lang="en-US"/><a:t>${escapeXml(title)}</a:t></a:r></a:p>` +
    `</p:txBody>` +
    `</p:sp>` +
    `</p:spTree></p:cSld></p:sld>`;
  return writeZip(path, (zip) => {
    zip.file(
      "[Content_Types].xml",
      contentTypes([
        [
          "/ppt/presentation.xml",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        ],
        [
          "/ppt/slides/slide1.xml",
          "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
        ],
      ])
    );
    zip.file("_rels/.rels", rootRels("ppt/presentation.xml"));
    zip.file("ppt/presentation.xml", presentation);
    zip.file("ppt/_rels/presentation.xml.rels", presentationRels);
    zip.file("ppt/slides/slide1.xml", slide);
  });
}

const ODT_MIMETYPE = "application/vnd.oasis.opendocument.text";

/** ODF text document with one paragraph holding `text`. */
export async function makeOdt(path: string, text: string): Promise<string> {
  const manifest =
    XML_HEADER +
    `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" ` +
    `manifest:version="1.2">` +
    `<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${ODT_MIMETYPE}"/>` +
    `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
    `</manifest:manifest>`;
  const content =
    XML_HEADER +
    `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
    `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">` +
    `<office:body><office:text><text:p>${escapeXml(text)}</text:p></office:text></office:body>` +
    `</office:document-content>`;
  return writeZip(path, (zip) => {
    // The mimetype entry must be first and stored uncompressed for ODF readers.
    zip.file("mimetype", ODT_MIMETYPE, { compression: "STORE" });
    zip.file("META-INF/manifest.xml", manifest);
    zip.file("content.xml", content);
  });
}
