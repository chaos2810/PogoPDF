use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let engine_exe = manifest_dir.join("binaries").join("engine.exe");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());

    embed_engine(&engine_exe, &out_dir);

    println!("cargo:rerun-if-changed={}", engine_exe.display());
}

fn embed_engine(engine_exe: &Path, out_dir: &Path) {
    let meta = match std::fs::read(engine_exe) {
        Ok(bytes) => {
            let blob = zstd::bulk::compress(&bytes, 19)
                .unwrap_or_else(|e| panic!("zstd compression of engine failed: {e}"));
            std::fs::write(out_dir.join("engine.blob"), &blob).expect("write engine.blob");
            format!(
                "pub const ENGINE_BLOB_ZSTD: &[u8] = include_bytes!(\"engine.blob\");\n\
                 pub const ENGINE_SHA256: &str = \"{}\";\n\
                 pub const ENGINE_RAW_SIZE: u64 = {};\n",
                sha256_hex(&bytes),
                bytes.len()
            )
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            println!(
                "cargo:warning=engine binary not found at {}; embedding an empty engine blob",
                engine_exe.display()
            );
            "pub const ENGINE_BLOB_ZSTD: &[u8] = &[];\n\
             pub const ENGINE_SHA256: &str = \"\";\n\
             pub const ENGINE_RAW_SIZE: u64 = 0;\n"
                .to_string()
        }
        Err(e) => panic!("failed to read engine binary {}: {e}", engine_exe.display()),
    };

    std::fs::write(out_dir.join("engine_meta.rs"), meta).expect("write engine_meta.rs");
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
