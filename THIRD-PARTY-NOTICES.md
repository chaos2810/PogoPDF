# Third-party notices

PogoPDF's own source code is licensed under the MIT License (see [LICENSE](LICENSE)).
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

`engine.cjs`, `pdf.worker.mjs` and pdfjs-dist's `standard_fonts/` directory are
copied into `engine-deps-<id>/`; the remaining packages are copied under
`engine-deps-<id>/node_modules/`. This includes the transitive dependency trees
of `pdfkit` (fontkit, linebreak, png-js, @noble/ciphers, @noble/hashes, fflate,
…; MIT) and `jsdom` (parse5, css-tree, tough-cookie, undici, whatwg-*, …), whose
license texts ship alongside the packages. Across those two closures the
licenses are MIT, ISC, BSD (2- and 3-clause), Apache-2.0 (@swc/helpers,
xml-name-validator), MIT-0, 0BSD, CC0-1.0 (mdn-data) and `MIT AND Zlib` (pako);
`dompurify` is dual-licensed `MPL-2.0 OR Apache-2.0`. All are permissive or, in
dompurify's MPL path, weak-copyleft; no AGPL component is present.

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
