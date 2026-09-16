use std::path::{Path, PathBuf};

mod generated {
    include!(concat!(env!("OUT_DIR"), "/engine_meta.rs"));
}

use generated::ENGINE_BLOB_ZSTD;

const BLOB_MISSING_RELEASE: &str =
    "engine blob missing — run engine/scripts/build-release.ps1 before release builds";

/// Where the extracted engine and its dependencies live, keyed by the content
/// hash of the staged artifacts so a new engine build lands in fresh paths.
pub struct EngineRuntime {
    pub exe: PathBuf,
    pub deps: PathBuf,
}

/// Extract the embedded engine executable and its native dependency tree into a
/// per-user cache and return both paths.
///
/// The release engine is two embedded artifacts: the SEA `engine.exe` (a Node
/// runtime whose bootstrap loads the real bundle from disk) and `engine-deps.tar`
/// (the bundled `engine.cjs` plus the `node_modules` it requires at runtime).
/// Both are hash-keyed so a new engine build extracts alongside the old one; the
/// engine is spawned with the deps directory as its working directory so the
/// bootstrap finds it.
pub fn ensure_runtime() -> Result<EngineRuntime, String> {
    if ENGINE_BLOB_ZSTD.is_empty() || generated::DEPS_BLOB_ZSTD.is_empty() {
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

    let exe = ensure_exe(&cache_dir)?;
    let deps = ensure_deps(&cache_dir)?;
    Ok(EngineRuntime { exe, deps })
}

fn ensure_exe(cache_dir: &Path) -> Result<PathBuf, String> {
    // Named from the combined build id, not the exe hash: the SEA bootstrap
    // derives its sibling deps dir from this filename, so the two artifacts
    // must share one key that changes whenever either file changes.
    let key = short_hash(generated::ENGINE_BUILD_ID);
    let target = cache_dir.join(format!("engine-{key}.exe"));

    if is_valid_cached(&target, generated::ENGINE_RAW_SIZE)? {
        return Ok(target);
    }

    let raw = zstd::bulk::decompress(ENGINE_BLOB_ZSTD, generated::ENGINE_RAW_SIZE as usize)
        .map_err(|e| format!("failed to decompress embedded engine: {e}"))?;
    if sha256_hex(&raw) != generated::ENGINE_SHA256 {
        return Err("embedded engine failed its own hash check".to_string());
    }

    // Per-process temp name so two concurrent first launches never share a file.
    let tmp = cache_dir.join(format!("engine-{key}.exe.{}.tmp", std::process::id()));
    write_verify_rename(&tmp, &target, &raw)?;
    Ok(target)
}

/// Unpack `engine-deps.tar` into `engine-deps-<hash>/`.
///
/// The tar is hash-verified before extraction, so a valid cache is recognised
/// by a marker file holding that hash (re-reading every extracted file would
/// mean hashing ~60 MB on each launch). Extraction goes to a per-process temp
/// directory that is renamed into place, matching the exe's race handling.
fn ensure_deps(cache_dir: &Path) -> Result<PathBuf, String> {
    // Named from the combined build id (see ensure_exe) so the SEA bootstrap can
    // derive this directory from its own filename. The marker holds the deps
    // content hash, which is what actually validates the extracted tree.
    let key = short_hash(generated::ENGINE_BUILD_ID);
    let target = cache_dir.join(format!("engine-deps-{key}"));
    let marker = target.join(".extracted");

    if is_valid_deps(&marker, generated::DEPS_SHA256) {
        return Ok(target);
    }

    let raw = zstd::bulk::decompress(generated::DEPS_BLOB_ZSTD, generated::DEPS_RAW_SIZE as usize)
        .map_err(|e| format!("failed to decompress embedded engine deps: {e}"))?;
    let actual = sha256_hex(&raw);
    if actual != generated::DEPS_SHA256 {
        return Err(format!(
            "embedded engine deps hash mismatch: expected {}, got {actual}",
            generated::DEPS_SHA256
        ));
    }

    let tmp = cache_dir.join(format!(
        "engine-deps-{key}.{}.tmp",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)
        .map_err(|e| format!("failed to create {tmp:?}: {e}"))?;

    if let Err(e) = unpack_tar(&raw, &tmp) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    std::fs::write(tmp.join(".extracted"), generated::DEPS_SHA256)
        .map_err(|e| format!("failed to write deps marker: {e}"))?;

    match std::fs::rename(&tmp, &target) {
        Ok(()) => Ok(target),
        Err(e) => {
            // A concurrent instance may have won the race (rename onto an
            // existing directory fails on Windows). Fall back to its cache.
            let _ = std::fs::remove_dir_all(&tmp);
            if is_valid_deps(&marker, generated::DEPS_SHA256) {
                Ok(target)
            } else {
                Err(format!("failed to rename into {target:?}: {e}"))
            }
        }
    }
}

fn unpack_tar(raw: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(raw);
    // `unpack` rejects entries whose paths escape `dest` (path traversal).
    archive
        .unpack(dest)
        .map_err(|e| format!("failed to unpack engine deps into {dest:?}: {e}"))
}

fn cache_dir() -> PathBuf {
    match std::env::var("LOCALAPPDATA") {
        Ok(base) if !base.is_empty() => PathBuf::from(base).join("PogoPDF").join("bin"),
        _ => std::env::temp_dir().join("PogoPDF").join("bin"),
    }
}

fn short_hash(hash: &str) -> &str {
    &hash[..16]
}

fn is_valid_cached(path: &Path, expected_len: u64) -> Result<bool, String> {
    match std::fs::metadata(path) {
        Ok(meta) => Ok(meta.len() == expected_len),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("failed to stat cached engine {path:?}: {e}")),
    }
}

fn is_valid_deps(marker: &Path, expected: &str) -> bool {
    matches!(std::fs::read_to_string(marker), Ok(s) if s == expected)
}

/// Write the decompressed bytes to `tmp`, verify the bytes on disk against the
/// embedded hash, then rename into `target`. A stale or corrupted target is
/// replaced; the verified temp file always wins. If the rename fails because a
/// concurrent instance won the race (the temp is gone, the target is now valid),
/// this instance falls back to the winner's file and drops its own temp.
fn write_verify_rename(
    tmp: &Path,
    target: &Path,
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
        Err(e) => match is_valid_cached(target, generated::ENGINE_RAW_SIZE) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tar_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (name, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, name, &data[..])
                .expect("append tar entry");
        }
        builder.into_inner().expect("finish tar")
    }

    #[test]
    fn unpack_tar_restores_files_and_directories() {
        let raw = tar_with(&[
            ("engine.cjs", b"bundle"),
            ("node_modules/@napi-rs/canvas/package.json", b"{}"),
        ]);
        let dest = std::env::temp_dir().join(format!("pogo-unpack-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();

        unpack_tar(&raw, &dest).expect("unpack");

        assert_eq!(
            std::fs::read(dest.join("engine.cjs")).unwrap(),
            b"bundle"
        );
        assert_eq!(
            std::fs::read(dest.join("node_modules/@napi-rs/canvas/package.json")).unwrap(),
            b"{}"
        );
        let _ = std::fs::remove_dir_all(&dest);
    }

    /// Hand-build a ustar archive whose single entry is named `name`, because
    /// `tar::Builder` refuses to construct `..` paths at all — the unpack-side
    /// guard is what this test needs to exercise.
    fn raw_tar_entry(name: &str, data: &[u8]) -> Vec<u8> {
        let mut header = [0u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        header[100..108].copy_from_slice(b"0000644\0"); // mode
        header[108..116].copy_from_slice(b"0000000\0"); // uid
        header[116..124].copy_from_slice(b"0000000\0"); // gid
        let size = format!("{:011o}\0", data.len());
        header[124..136].copy_from_slice(size.as_bytes());
        header[136..148].copy_from_slice(b"00000000000\0"); // mtime
        header[148..156].copy_from_slice(b"        "); // checksum placeholder
        header[156] = b'0'; // typeflag: regular file
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");

        let checksum: u32 = header.iter().map(|&b| b as u32).sum();
        let cksum = format!("{:06o}\0 ", checksum);
        header[148..156].copy_from_slice(cksum.as_bytes());

        let mut out = Vec::new();
        out.extend_from_slice(&header);
        out.extend_from_slice(data);
        out.resize(out.len().div_ceil(512) * 512, 0);
        out.extend_from_slice(&[0u8; 1024]);
        out
    }

    #[test]
    fn unpack_tar_does_not_escape_the_destination() {
        // `tar` skips entries whose names contain `..` (see Entry::unpack_in);
        // what matters is that nothing lands outside the destination dir.
        let raw = raw_tar_entry("../escaped.txt", b"nope");
        let dest = std::env::temp_dir().join(format!("pogo-escape-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();

        unpack_tar(&raw, &dest).expect("escaping entries are skipped, not fatal");

        assert!(!dest.parent().unwrap().join("escaped.txt").exists());
        assert!(!dest.join("escaped.txt").exists());
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn deps_marker_round_trips_the_hash() {
        let dir = std::env::temp_dir().join(format!("pogo-marker-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join(".extracted");

        assert!(!is_valid_deps(&marker, "abc123"));

        let mut file = std::fs::File::create(&marker).unwrap();
        file.write_all(b"abc123").unwrap();
        drop(file);
        assert!(is_valid_deps(&marker, "abc123"));
        assert!(!is_valid_deps(&marker, "different"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn short_hash_is_the_first_16_chars() {
        assert_eq!(short_hash("0123456789abcdefdeadbeef"), "0123456789abcdef");
    }

    /// The exe and deps dir must be named from the same build id: the SEA
    /// bootstrap derives `engine-deps-<id>` from its own `engine-<id>.exe`
    /// filename. If these ever diverged the release engine could not find its
    /// dependencies at all.
    #[test]
    fn exe_and_deps_share_one_build_id() {
        assert_eq!(generated::ENGINE_BUILD_ID.len(), 64);
        assert_eq!(short_hash(generated::ENGINE_BUILD_ID).len(), 16);
        // Distinct from the per-file hashes so an unchanged exe with a changed
        // tar (or vice versa) still yields a fresh key.
        if !ENGINE_BLOB_ZSTD.is_empty() {
            assert_ne!(generated::ENGINE_BUILD_ID, generated::ENGINE_SHA256);
        }
    }

    /// End-to-end check of the real embedded payload: decompress both blobs,
    /// extract the deps tar, and confirm the files the engine needs at runtime
    /// are present. Skips when `build-release.ps1` has not been run (the blobs
    /// are empty placeholders), so `cargo test` stays usable without a release
    /// build. The extraction is redirected into a scratch directory.
    #[test]
    fn embedded_payload_extracts_the_engine_and_its_native_deps() {
        if ENGINE_BLOB_ZSTD.is_empty() || generated::DEPS_BLOB_ZSTD.is_empty() {
            eprintln!("skipping: engine blobs are empty placeholders");
            return;
        }

        let raw = zstd::bulk::decompress(
            generated::DEPS_BLOB_ZSTD,
            generated::DEPS_RAW_SIZE as usize,
        )
        .expect("decompress embedded deps");
        assert_eq!(sha256_hex(&raw), generated::DEPS_SHA256);

        let dest = std::env::temp_dir().join(format!("pogo-payload-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();
        unpack_tar(&raw, &dest).expect("unpack embedded deps");

        for rel in [
            "engine.cjs",
            "pdf.worker.mjs",
            "node_modules/sharp/package.json",
            "node_modules/@napi-rs/canvas/package.json",
            "node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node",
            "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf",
        ] {
            assert!(
                dest.join(rel).is_file(),
                "embedded deps are missing {rel}"
            );
        }

        let _ = std::fs::remove_dir_all(&dest);
    }
}
