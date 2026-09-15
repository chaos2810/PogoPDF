use std::path::PathBuf;

mod generated {
    include!(concat!(env!("OUT_DIR"), "/engine_meta.rs"));
}

use generated::ENGINE_BLOB_ZSTD;

const BLOB_MISSING_RELEASE: &str =
    "engine blob missing — run engine/scripts/build-release.ps1 before release builds";

/// Extract the embedded, compressed engine executable into a per-user cache and
/// return its path. The cached file is keyed by the content hash of the raw exe
/// so that a new engine build extracts to a fresh name and old files are left
/// untouched. Extraction is skipped when the cached file already has the
/// expected length.
pub fn ensure_engine_exe() -> Result<PathBuf, String> {
    if ENGINE_BLOB_ZSTD.is_empty() {
        return Err(if cfg!(debug_assertions) {
            "engine blob not embedded in this build; dev mode runs the TypeScript engine directly"
                .to_string()
        } else {
            BLOB_MISSING_RELEASE.to_string()
        });
    }

    let cache_dir = cache_dir();
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("failed to create engine cache dir {cache_dir:?}: {e}"))?;

    let target = cache_dir.join(format!("engine-{}.exe", short_hash()));

    if is_valid_cached(&target)? {
        return Ok(target);
    }

    let raw = zstd::bulk::decompress(ENGINE_BLOB_ZSTD, generated::ENGINE_RAW_SIZE as usize)
        .map_err(|e| format!("failed to decompress embedded engine: {e}"))?;

    // Per-process temp name so two concurrent first launches never share a file.
    let tmp = cache_dir.join(format!("engine-{}.exe.{}.tmp", short_hash(), std::process::id()));
    write_verify_rename(&tmp, &target, &raw)?;
    Ok(target)
}

fn cache_dir() -> PathBuf {
    match std::env::var("LOCALAPPDATA") {
        Ok(base) if !base.is_empty() => PathBuf::from(base).join("PogoPDF").join("bin"),
        _ => std::env::temp_dir().join("PogoPDF").join("bin"),
    }
}

fn short_hash() -> &'static str {
    &generated::ENGINE_SHA256[..16]
}

fn is_valid_cached(path: &std::path::Path) -> Result<bool, String> {
    match std::fs::metadata(path) {
        Ok(meta) => Ok(meta.len() == generated::ENGINE_RAW_SIZE),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("failed to stat cached engine {path:?}: {e}")),
    }
}

/// Write the decompressed bytes to `tmp`, verify the bytes on disk against the
/// embedded hash, then rename into `target`. A stale or corrupted target is
/// replaced; the verified temp file always wins. If the rename fails because a
/// concurrent instance won the race (the temp is gone, the target is now valid),
/// this instance falls back to the winner's file and drops its own temp.
fn write_verify_rename(
    tmp: &std::path::Path,
    target: &std::path::Path,
    bytes: &[u8],
) -> Result<(), String> {
    use std::io::Write;

    // Overwrite any stale temp file so a crashed extraction cannot poison the cache.
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(tmp)
        .map_err(|e| format!("failed to create {tmp:?}: {e}"))?;
    file.write_all(bytes)
        .map_err(|e| format!("failed to write {tmp:?}: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("failed to sync {tmp:?}: {e}"))?;
    drop(file);

    let written = std::fs::read(tmp).map_err(|e| format!("failed to read back {tmp:?}: {e}"))?;
    let actual = sha256_hex(&written);
    if actual != generated::ENGINE_SHA256 {
        let _ = std::fs::remove_file(tmp);
        return Err(format!(
            "extracted engine hash mismatch: expected {}, got {actual}",
            generated::ENGINE_SHA256
        ));
    }

    // std::fs::rename uses MOVEFILE_REPLACE_EXISTING on Windows, so this
    // overwrites a stale or corrupt target when `tmp` is present.
    match std::fs::rename(tmp, target) {
        Ok(()) => Ok(()),
        Err(e) => match is_valid_cached(target) {
            // Another instance won the race and left a valid engine; `tmp` is
            // redundant (it may already be gone, hence ignoring the remove error).
            Ok(true) => {
                let _ = std::fs::remove_file(tmp);
                Ok(())
            }
            _ => Err(format!("failed to rename into {target:?}: {e}")),
        },
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
