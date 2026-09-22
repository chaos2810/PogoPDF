# Third-party notices

PogoPDF is licensed under the GNU AGPL-3.0 (see [LICENSE](LICENSE)).
This file lists the third-party components that ship inside the released
`pogopdf.exe` and their licenses, and carries the attribution notices required
by the LGPL-3.0-or-later components.

The release app embeds the Node engine and its native dependency tree as two
compressed blobs. On first launch they are extracted to
`%LOCALAPPDATA%\PogoPDF\bin\engine-<id>.exe` and
`%LOCALAPPDATA%\PogoPDF\bin\engine-deps-<id>\`. `engine-<id>.exe` is a
self-contained Node.js Single Executable Application containing the Node.js
runtime (see below); the components under "Engine runtime" run inside it as a
separate process at runtime and are not linked into `pogopdf.exe`.

## Node.js runtime (embedded inside `engine-<id>.exe`)

| Component | Version | License |
|---|---|---|
| Node.js runtime (node.exe basis for the SEA build) | 24.x | MIT |
| OpenSSL (bundled in Node.js) | 3.x | Apache-2.0 |
| V8, ICU, libuv, zlib, and other bundled deps | as bundled in Node.js | see Node.js's own `LICENSE` and `THIRD_PARTY_NOTICES` in the Node.js source distribution |

Node.js's full license and bundled-component notices are available in the
Node.js source distribution: <https://github.com/nodejs/node/blob/main/LICENSE>.

## Engine runtime (bundled JavaScript)

| Component | Version | License |
|---|---|---|
| pdf-lib | 1.17.1 | MIT |
| pdfjs-dist | 6.3.289 | Apache-2.0 |
| pdfkit | 0.20.2 | MIT |
| csv-parse | 7.0.2 | MIT |
| marked | 18.0.13 | MIT |
| dompurify | 3.4.15 | MPL-2.0 OR Apache-2.0 |
| jsdom | 30.1.0 | MIT |
| jszip | 3.10.2 | MIT (`MIT OR GPL-3.0-or-later`) |
| zod | 3.25.76 | MIT |
| @napi-rs/canvas | 1.0.9 | MIT |
| @napi-rs/canvas-win32-x64-msvc | 1.0.9 | MIT |
| sharp | 0.35.4 | Apache-2.0 |
| @img/sharp-win32-x64 | 0.35.4 | **Apache-2.0 AND LGPL-3.0-or-later** |
| @img/colour | 1.1.0 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| tesseract.js | 7.0.0 | Apache-2.0 |
| tesseract.js-core | 7.0.0 | Apache-2.0 |
| tesseract language data (eng, chi_tra, chi_sim, jpn, kor, deu, fra, spa) | tessdata_fast, main | Apache-2.0 |
| qpdf (qpdf.exe + qpdf29.dll + MSVC runtime DLLs) | 11.10.1 | Apache-2.0 |
| mupdf (MuPDF.js wasm) | 1.28.1 | **AGPL-3.0-or-later** |
| Ghostscript (`gswin64c.exe` console binary + `gsdll64.dll` + resources) | 10.08.0 | **AGPL-3.0-or-later** |
| @bentopdf/pymupdf-wasm (Pyodide + PyMuPDF and bundled wheels) | 0.11.16 | **AGPL-3.0-only** |
| LibreOffice (headless `soffice`) | 26.2.6 | **MPL-2.0** with LGPL-3.0-or-later components |
| @signpdf/placeholder-pdf-lib | 3.3.0 | MIT |
| @signpdf/signer-p12 | 3.3.0 | MIT |
| @signpdf/signpdf | 3.3.0 | MIT |
| @signpdf/utils | 3.3.0 | MIT |
| node-forge | 1.4.0 | BSD-3-Clause OR GPL-2.0 |
| pkijs | 3.4.1 | BSD-3-Clause |
| asn1js | 3.0.10 | BSD-3-Clause |
| bytestreamjs | 2.0.1 | BSD-3-Clause |
| pvtsutils | 1.3.6 | MIT |
| pvutils | 1.2.0 | MIT |
| @noble/hashes | 1.8.0 | MIT |

The digital-signature stack (`@signpdf/*`, `node-forge`, `pkijs` and its ASN.1
support packages) is pure JavaScript and is bundled directly into `engine.cjs`;
none of it is staged as a separate file or `--external`. It backs `digitalSign`,
`validateSignature` and `timestamp`. `node-forge` is used under its
BSD-3-Clause option (`node-forge` is dual-licensed BSD-3-Clause OR GPL-2.0).

`engine.cjs`, `pdf.worker.mjs` and pdfjs-dist's `standard_fonts/` directory are
copied into `engine-deps-<id>/`; `qpdf.exe` and its runtime DLLs are copied into
`engine-deps-<id>/qpdf/`; the OCR language data is copied into
`engine-deps-<id>/ocr-data/`; the trimmed LibreOffice tree is copied into
`engine-deps-<id>/lo/`; the remaining packages are copied under
`engine-deps-<id>/node_modules/`. This includes the transitive dependency trees
of `pdfkit` (fontkit, linebreak, png-js, @noble/ciphers, @noble/hashes, fflate,
…; MIT) and `jsdom` (parse5, css-tree, tough-cookie, undici, whatwg-*, …), whose
license texts ship alongside the packages. Across those two closures the
licenses are MIT, ISC, BSD (2- and 3-clause), Apache-2.0 (@swc/helpers,
xml-name-validator), MIT-0, 0BSD, CC0-1.0 (mdn-data) and `MIT AND Zlib` (pako);
`dompurify` is dual-licensed `MPL-2.0 OR Apache-2.0`. All are permissive or, in
dompurify's MPL path, weak-copyleft. The AGPL engines land in Phase 2 (see the section below).

## UI (bundled into the app)

| Component | Version | License |
|---|---|---|
| pdfjs-dist (thumbnails) | 4.10.38 | Apache-2.0 |
| react / react-dom | 18.3.1 | MIT |
| lucide-react | 0.447.0 | ISC |
| @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT |

## Tauri shell (Rust crates linked into `pogopdf.exe`)

| Crate | Version | License |
|---|---|---|
| tauri / tauri-build / tauri-plugin-dialog | 2.x | Apache-2.0 OR MIT |
| tokio | 1.x | MIT |
| serde / serde_json | 1.x | Apache-2.0 OR MIT |
| sha2 | 0.10 | Apache-2.0 OR MIT |
| zstd | 0.13 | MIT |
| tar | 0.4 | Apache-2.0 OR MIT |

## Planned AGPL engines (Phase 2+)

Ghostscript has landed (Phase 4); its notice is in the section below. mupdf and
PyMuPDF, the AGPL components that have landed, are recorded in the sections
below.

## AGPL-3.0-or-later component: Ghostscript

PogoPDF's engine ships **Ghostscript** 10.08.0 for PDF/A conversion (`pdfToPdfA`)
and font-to-outline conversion (`fontOutline`): the console binary
`gswin64c.exe` runs `-sDEVICE=pdfwrite` with the PDF/A part flags or with
`-dNoOutputFonts`. Ghostscript is invoked as a spawned command-line process, not
linked into `pogopdf.exe`.

- Artifex Software, Inc., <https://www.ghostscript.com>
- License: **GNU Affero General Public License, version 3.0 or later
  (AGPL-3.0-or-later)**, <https://www.gnu.org/licenses/agpl-3.0.html>;
  Artifex offers alternative commercial licensing at
  <https://www.artifex.com/licensing/>.
- Source: <https://github.com/ArtifexSoftware/ghostpdl>
- Release artifacts (including the Windows installer this build stages):
  <https://github.com/ArtifexSoftware/ghostpdl-downloads/releases>

`engine/scripts/fetch-ghostscript.ps1` downloads the official Windows x64 NSIS
installer (`gs10080w64.exe`), verifies it against the release's `SHA512SUMS`
(with the pinned SHA-512 as a fallback), extracts it, and stages a trimmed tree
at `engine-deps-<id>/gs/`: `bin/` (`gswin64c.exe` and `gsdll64.dll`), `lib/`
(PostScript resources), `Resource/` (fonts and CMaps), `iccprofiles/` (the sRGB
profile the PDF/A OutputIntent embeds, read from Ghostscript's ROM filesystem at
`%rom%iccprofiles/srgb.icc`), and `doc/COPYING` (the full AGPL-3.0 text). The
rest of `doc/` (~22.6 MB) and `examples/` (~1.2 MB) are not shipped. The staged
AGPL text ships at `engine-deps-<id>/gs/doc/COPYING`; the corresponding source
for the shipped build is the GhostPDL source at the repository above.

### Build-machine extraction tools (not shipped)

The NSIS installer cannot be unpacked by the standalone `7zr.exe` or `7za.exe`
builds (both report "Unsupported archive type"), and its `/S /D=` silent install
requires elevation. The fetch script therefore downloads two more build-machine
tools into `%TEMP%` only:

- `7zr.exe` (7-Zip 26.03, **Public domain**, <https://www.7-zip.org>) unpacks the
  official 7-Zip installer's own 7z self-extracting archive.
- `7z.exe` + `7z.dll` (from the 7-Zip 26.03 x64 installer, **GNU LGPL** with the
  unRAR license restriction on some code, plus BSD 2- and 3-clause licensed
  parts) then unpack the NSIS installer.

Neither tool is copied into `gs-bin/` or `engine-deps-<id>/`; both live only in
the build machine's `%TEMP%` during the fetch. The full 7-Zip license text ships
inside the 7-Zip installer at `License.txt`.

Because Ghostscript is AGPL-3.0-or-later and PogoPDF spawns it as a separate
process, the combined work is distributed under the terms of the AGPL, consistent
with PogoPDF's own AGPL-3.0 license (see [LICENSE](LICENSE)).

## AGPL-3.0-or-later component: MuPDF.js

PogoPDF's engine uses **MuPDF.js** (the `mupdf` npm package), version 1.28.1,
for rich-content conversion (EPUB, FB2, and the comic/image path). MuPDF.js is a
WebAssembly build of MuPDF published by Artifex Software, Inc. and is licensed
under the **GNU Affero General Public License, version 3.0 or later
(AGPL-3.0-or-later)**:

- Copyright (C) 2004-2026 Artifex Software, Inc.
- License: AGPL-3.0-or-later, <https://www.gnu.org/licenses/agpl-3.0.html>
- Source: <https://mupdf.com> and the npm package `mupdf`
  (<https://www.npmjs.com/package/mupdf>, source repository
  <https://github.com/ArtifexSoftware/mupdf>)

The package is `--external` to the engine bundle and is staged whole into
`engine-deps-<id>/node_modules/mupdf/`, including its `dist/mupdf-wasm.wasm`
binary, which the engine loads at runtime. The complete corresponding source for
the shipped MuPDF.js build is the `mupdf` 1.28.1 npm package together with the
MuPDF source at the repository above. Artifex offers alternative commercial
licensing; see <https://www.artifex.com/contact/mupdf-js>.

Because MuPDF is AGPL-3.0-or-later and PogoPDF links it at runtime as a module
inside its engine process, the combined work is distributed under the terms of
the AGPL, consistent with PogoPDF's own AGPL-3.0 license (see
[LICENSE](LICENSE)). The full AGPL text ships with the package at
`node_modules/mupdf/LICENSE`.

Note: the official MuPDF.js wasm build compiles the XPS module out
(`platform/wasm/tools/build.sh` passes `xps=no`), so the shipped engine cannot
read XPS/OXPS; the `xpsToPdf` tool reports a typed unsupported-format error.
This is recorded so the capability gap is not mistaken for a license or
packaging omission.

## AGPL-3.0-only component: PyMuPDF compiled to WebAssembly

PogoPDF's engine uses **`@bentopdf/pymupdf-wasm`**, version 0.11.16, for in-place
PDF text editing (the `editText` tool). The package is a WebAssembly build of
**PyMuPDF** (the Python bindings for Artifex's MuPDF) produced by BentoPDF. It
does not link a thin wasm binding directly: it embeds **Pyodide** (a full
CPython interpreter compiled to WebAssembly) plus a set of Python wheels.

- PyMuPDF: Copyright (C) 2004-2026 Artifex Software, Inc.
- PyMuPDF license: **AGPL-3.0-only**,
  <https://www.gnu.org/licenses/agpl-3.0.html>; commercial licensing is offered
  separately by Artifex.
- Package source: <https://github.com/alam00000/bentopdf-pymupdf-wasm>
  (npm: <https://www.npmjs.com/package/@bentopdf/pymupdf-wasm>)
- Pyodide: <https://pyodide.org>, MPL-2.0 (the runtime under the package's
  `assets/` directory: `pyodide.js`, `pyodide.asm.js`, `pyodide.asm.wasm`,
  `python_stdlib.zip`, `pyodide-lock.json`)

The package is `--external` to the engine bundle and is staged **whole** into
`engine-deps-<id>/node_modules/@bentopdf/pymupdf-wasm/`, including its
`assets/` directory of static files that are not declared as package.json
dependencies: the Pyodide runtime and lock file, the PyMuPDF wheel
(`pymupdf-1.26.3-cp313-none-pyodide_2025_0_wasm32.whl`), and the supporting
wheels it ships (pymupdf4llm, fonttools, lxml, numpy, opencv_python, pdf2docx,
python_docx, typing_extensions). At boot the loader loads only the PyMuPDF
wheel; the remaining wheels are shipped in the staged package but are not
loaded into the interpreter until a future feature needs them.

Bundled wheels and their licenses:

| Wheel | License |
|---|---|
| pymupdf | AGPL-3.0 or commercial (dual-licensed by Artifex) |
| pymupdf4llm | AGPL-3.0 or commercial (dual-licensed by Artifex) |
| pdf2docx | GPL-3.0 |
| opencv-python | Apache-2.0 |
| numpy | BSD-3-Clause |
| lxml | BSD-3-Clause |
| fonttools | MIT |
| python-docx | MIT |
| typing_extensions | PSF-2.0 |

Each wheel carries its own license metadata under its `.dist-info` directory in
the Pyodide site-packages; the complete corresponding source for the shipped
PyMuPDF build is the `@bentopdf/pymupdf-wasm` package together with the PyMuPDF
source at <https://github.com/pymupdf/PyMuPDF>.

Because PyMuPDF is AGPL-3.0-only and PogoPDF loads it at runtime inside its
engine process, the combined work is distributed under the terms of the AGPL,
consistent with PogoPDF's own AGPL-3.0 license (see [LICENSE](LICENSE)). The
package's license text ships at
`node_modules/@bentopdf/pymupdf-wasm/LICENSE`.

## LGPL-3.0-or-later component: libvips (via sharp)

The prebuilt `@img/sharp-win32-x64` package that PogoPDF ships includes:

- `lib/libvips-42.dll`
- `lib/libvips-cpp-8.18.6.dll`
- `lib/sharp-win32-x64-0.35.4.node`

The libvips libraries are licensed under the **GNU Lesser General Public License,
version 3.0 or later (LGPL-3.0-or-later)**; the sharp binding and its platform
package are Apache-2.0. The full license texts ship with the npm packages
(`node_modules/@img/sharp-win32-x64/LICENSE`) and are available at:

- LGPL-3.0: <https://www.gnu.org/licenses/lgpl-3.0.txt>
- GPL-3.0 (LGPL-3.0 incorporates it by reference): <https://www.gnu.org/licenses/gpl-3.0.txt>
- libvips source: <https://github.com/libvips/libvips>

### LGPL §4 notice (combined work)

libvips is used as a dynamically-loaded shared library by PogoPDF's engine. It
is a "work that uses the Library" in the sense of LGPL-3.0 §4: the engine
invokes libvips through sharp's Node binding at runtime; no libvips code is
statically linked or modified. PogoPDF does not modify libvips.

Under LGPL-3.0 §4 you have the right to obtain the source for the library and
to relink the combined work against a modified version of the library. The
extracted DLLs are ordinary independent files on disk:

```
%LOCALAPPDATA%\PogoPDF\bin\engine-deps-<id>\node_modules\@img\sharp-win32-x64\lib\
  libvips-42.dll
  libvips-cpp-8.18.6.dll
  sharp-win32-x64-0.35.4.node
```

To exercise that right, replace the `libvips*.dll` files in that directory with
a build of your own and restart PogoPDF; the engine loads them from that
location at runtime. (If the application is ever updated, the extracted
`engine-deps-<id>` path changes; re-apply the replacement to the new directory.)

The corresponding libvips source for the shipped build is available from the
sharp project's release artifacts and the libvips repository linked above.

## LibreOffice (office document conversion)

PogoPDF's engine ships **LibreOffice** 26.2.6 for `officeToPdf`: headless
`soffice.exe --convert-to pdf` converts Word, Excel, PowerPoint, RTF, and ODF
documents. LibreOffice is invoked as a spawned command-line process, not linked
into `pogopdf.exe`.

- The Document Foundation, <https://www.libreoffice.org>
- LibreOffice is primarily licensed under the **Mozilla Public License 2.0
  (MPL-2.0)**, <https://www.mozilla.org/MPL/2.0/>
- It bundles components under other licenses, including **LGPL-3.0-or-later**
  (for example, the HarfBuzz and libxml2-family libraries and several UNO
  pieces). The complete per-file license texts ship with the tree at
  `engine-deps-<id>/lo/license.txt`, `lo/LICENSE.html`, `lo/NOTICE`, and
  `lo/CREDITS.fodt`; upstream records the full component license inventory at
  <https://www.libreoffice.org/about-us/licenses/>.

Under MPL-2.0 §3.3 ("Distribution of a Larger Work"), the MPL permits combining
LibreOffice with PogoPDF's AGPL-3.0 code; that is the **Secondary License**
provision that lets an MPL-2.0 file be included in a Larger Work under the terms
of a secondary license. PogoPDF does not modify LibreOffice.

### Staged layout and trim

Only the files headless PDF conversion reads are shipped. `build-release.ps1`
stages `engine/lo-bin/` into `engine-deps-<id>/lo/`, excluding:

- `share/extensions/dict-*` (spell-check dictionaries, ~455 MB)
- all `*.mo` files (translated user-interface strings, ~262 MB; headless
  conversion renders documents, not the UI)
- `help/` (~11 MB), `readmes/` (~2 MB), and `share/gallery/` (~13 MB)

The retained tree is `program/` (the `soffice.exe` launcher, `soffice.bin`, and
its DLLs, which all resolve from the executable's own directory), `Fonts/`,
`presets/`, `share/config`, `share/registry`, and `share/xpdfimport`. This trim
was verified by converting a docx through the trimmed tree and extracting the
resulting text. The version, build id, and license files are retained.

If `engine/lo-bin/` is absent, `build-release.ps1` warns loudly and builds a
release without the office tools; `officeToPdf` then fails with a typed
unsupported-format error naming `engine/scripts/fetch-libreoffice.ps1`.
