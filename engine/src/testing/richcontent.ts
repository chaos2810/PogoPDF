import JSZip from "jszip";
import { writeFileSync } from "node:fs";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';

/**
 * Minimal hand-built rich-content fixtures. Each is a valid package that the
 * bundled mupdf wasm opens, with one piece of identifiable text:
 * - EPUB 3 zip (mimetype stored first, container.xml, content.opf, one xhtml)
 * - FB2 plain XML with a book-title and one body paragraph
 * - XPS OPC zip (Content_Types, rels, FixedDocumentSequence/Document/Page)
 * A comic is a plain zip of images, built by the test from image fixtures.
 */
async function writeZip(path: string, build: (zip: JSZip) => void): Promise<string> {
  const zip = new JSZip();
  build(zip);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(path, bytes);
  return path;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const EPUB_MIMETYPE = "application/epub+zip";

/** EPUB 3 with one chapter whose heading is `heading` and body is `body`. */
export async function makeEpub(path: string, heading: string, body = "Body text."): Promise<string> {
  const container =
    XML_HEADER +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
    "</container>";
  const opf =
    XML_HEADER +
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:identifier id="bookid">urn:uuid:00000000-0000-0000-0000-000000000001</dc:identifier>' +
    `<dc:title>${escapeXml(heading)}</dc:title><dc:language>en</dc:language>` +
    "</metadata>" +
    '<manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
    '<spine><itemref idref="ch1"/></spine></package>';
  const xhtml =
    XML_HEADER +
    '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head>' +
    `<body><h1>${escapeXml(heading)}</h1><p>${escapeXml(body)}</p></body></html>`;
  return writeZip(path, (zip) => {
    // OCF requires the mimetype entry first and stored uncompressed.
    zip.file("mimetype", EPUB_MIMETYPE, { compression: "STORE" });
    zip.file("META-INF/container.xml", container);
    zip.file("OEBPS/content.opf", opf);
    zip.file("OEBPS/chapter1.xhtml", xhtml);
  });
}

/** FB2 with the given book title and one paragraph of body text. */
export async function makeFb2(path: string, title: string, body = "Body text."): Promise<string> {
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" ' +
    'xmlns:xlink="http://www.w3.org/1999/xlink">' +
    `<description><title-info><book-title>${escapeXml(title)}</book-title></title-info></description>` +
    `<body><section><title><p>${escapeXml(title)}</p></title>` +
    `<p>${escapeXml(body)}</p></section></body></FictionBook>`;
  writeFileSync(path, xml, "utf8");
  return path;
}

/**
 * Minimal single-page XPS (OpenXPS OPC zip): Content_Types, package rels, a
 * FixedDocumentSequence pointing at a FixedDocument with one FixedPage holding a
 * Glyphs text run. The bundled mupdf wasm is compiled without XPS support, so
 * this fixture exists to prove the tool's open failure is a capability gap and
 * not malformed input (the full mupdf library renders it).
 */
export async function makeXps(path: string, text = "XPS Probe Text"): Promise<string> {
  const contentTypes =
    XML_HEADER +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/>' +
    '<Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/>' +
    '<Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/>' +
    "</Types>";
  const rels =
    XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.microsoft.com/xps/2005/06/fixedrepresentation" Target="/FixedDocSeq.fdseq"/>' +
    "</Relationships>";
  const fdseq =
    XML_HEADER +
    '<FixedDocumentSequence xmlns="http://schemas.microsoft.com/xps/2005/06">' +
    '<DocumentReference Source="/Documents/1/FixedDoc.fdoc"/></FixedDocumentSequence>';
  const fdoc =
    XML_HEADER +
    '<FixedDocument xmlns="http://schemas.microsoft.com/xps/2005/06">' +
    '<PageContent Source="/Documents/1/Pages/1.fpage"/></FixedDocument>';
  const fpage =
    XML_HEADER +
    '<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="816" Height="1056" xml:lang="en-US">' +
    `<Glyphs OriginX="96" OriginY="96" FontUri="/Resources/Fonts/A.odttf" FontRenderingEmSize="24" UnicodeString="${escapeXml(text)}" Fill="#000000"/>` +
    "</FixedPage>";
  return writeZip(path, (zip) => {
    zip.file("[Content_Types].xml", contentTypes);
    zip.file("_rels/.rels", rels);
    zip.file("FixedDocSeq.fdseq", fdseq);
    zip.file("Documents/1/FixedDoc.fdoc", fdoc);
    zip.file("Documents/1/Pages/1.fpage", fpage);
  });
}

/** A zip of image files (the comic container). Entry order is insertion order. */
export async function makeComicZip(
  path: string,
  entries: Array<{ name: string; bytes: Uint8Array }>
): Promise<string> {
  return writeZip(path, (zip) => {
    for (const entry of entries) zip.file(entry.name, entry.bytes);
  });
}
