use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let binaries = manifest_dir.join("binaries");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());

    let engine_exe = binaries.join("engine.exe");
    let engine_deps = binaries.join("engine-deps.tar");

    embed_engine(&engine_exe, &engine_deps, &out_dir);

    println!("cargo:rerun-if-changed={}", engine_exe.display());
    println!("cargo:rerun-if-changed={}", engine_deps.display());
}

/// Compress both staged artifacts and emit `engine_meta.rs`.
///
/// The release engine is two pieces: the SEA `engine.exe` (Node runtime + a
/// bootstrap that loads the real bundle from disk) and `engine-deps.tar` (the
/// bundled `engine.cjs` plus the native `node_modules` it requires at runtime).
/// Both are embedded so the app ships as a single file.
fn embed_engine(engine_exe: &Path, engine_deps: &Path, out_dir: &Path) {
    let mut meta = String::new();

    meta.push_str(&embed_one(
        engine_exe,
        out_dir,
        "engine.blob",
        "ENGINE_BLOB_ZSTD",
        "ENGINE_SHA256",
        "ENGINE_RAW_SIZE",
    ));
    meta.push_str(&embed_one(
        engine_deps,
        out_dir,
        "engine_deps.blob",
        "DEPS_BLOB_ZSTD",
        "DEPS_SHA256",
        "DEPS_RAW_SIZE",
    ));

    std::fs::write(out_dir.join("engine_meta.rs"), meta).expect("write engine_meta.rs");
}

/// Embed one file as a zstd-compressed blob plus its sha256/size constants. A
/// missing file yields an empty placeholder so `cargo check`/`cargo test`/
/// `tauri dev` still work without a release build having run.
fn embed_one(
    path: &Path,
    out_dir: &Path,
    blob_name: &str,
    blob_const: &str,
    sha_const: &str,
    size_const: &str,
) -> String {
    match std::fs::read(path) {
        Ok(bytes) => {
            let blob = zstd::bulk::compress(&bytes, 19)
                .unwrap_or_else(|e| panic!("zstd compression of {} failed: {e}", path.display()));
            std::fs::write(out_dir.join(blob_name), &blob)
                .unwrap_or_else(|e| panic!("write {blob_name}: {e}"));
            format!(
                "pub const {blob_const}: &[u8] = include_bytes!(\"{blob_name}\");\n\
                 pub const {sha_const}: &str = \"{}\";\n\
                 pub const {size_const}: u64 = {};\n",
                sha256_hex(&bytes),
                bytes.len()
            )
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            println!(
                "cargo:warning={} not found at {}; embedding an empty placeholder",
                blob_name,
                path.display()
            );
            format!(
                "pub const {blob_const}: &[u8] = &[];\n\
                 pub const {sha_const}: &str = \"\";\n\
                 pub const {size_const}: u64 = 0;\n"
            )
        }
        Err(e) => panic!("failed to read {}: {e}", path.display()),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}
