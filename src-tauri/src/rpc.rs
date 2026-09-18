use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A long-lived Node engine child process speaking JSON-RPC 2.0 over stdio.
///
/// Lines with an `id` are responses resolved against [`Self::pending`]; lines
/// without an `id` are notifications forwarded via the `on_notification`
/// callback captured at spawn time.
pub struct EngineProcess {
    // Interior mutability so `call` and `kill` can take `&self`. This lets the
    // sidecar state hand out shared `Arc<EngineProcess>` handles instead of
    // holding a lock for the whole (possibly long) engine call.
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Value>>>>,
    reader: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl EngineProcess {
    /// Spawn the engine from a whitespace-separated command string with the
    /// given working directory. `on_notification` runs on the reader thread for
    /// every protocol line that carries no `id`.
    pub fn spawn(
        engine_cmd: &str,
        cwd: &str,
        on_notification: impl Fn(Value) + Send + 'static,
    ) -> Result<Self, String> {
        // Release passes an absolute path that may contain spaces (per-user
        // cache under %LOCALAPPDATA%), so treat an existing file as the whole
        // program; otherwise fall back to the historical whitespace split that
        // dev commands like `node --import tsx src/engine.ts` rely on.
        let (program, args): (&str, Vec<&str>) = if Path::new(engine_cmd).is_file() {
            (engine_cmd, Vec::new())
        } else {
            let parts: Vec<&str> = engine_cmd.split_whitespace().collect();
            let (program, args) = parts
                .split_first()
                .ok_or_else(|| "empty engine command".to_string())?;
            (program, args.to_vec())
        };

        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command
            .spawn()
            .map_err(|e| format!("failed to spawn engine `{engine_cmd}`: {e}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "engine stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "engine stdout unavailable".to_string())?;

        let pending: Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = Arc::clone(&pending);

        let reader = std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                match value.get("id").and_then(Value::as_u64) {
                    Some(id) => {
                        if let Some(tx) = reader_pending.lock().unwrap().remove(&id) {
                            let _ = tx.send(value);
                        }
                    }
                    None => on_notification(value),
                }
            }
            // Engine stdout closed (EOF/error): drop all parked senders so every
            // waiting call() resolves with Err instead of hanging forever.
            reader_pending.lock().unwrap().clear();
        });

        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(Some(stdin)),
            next_id: AtomicU64::new(1),
            pending,
            reader: Mutex::new(Some(reader)),
        })
    }

    /// Send a request and await its response. The engine's JSON-RPC error
    /// object is returned as a JSON string so the UI can parse `{code,message}`.
    ///
    /// Takes `&self`: the stdin lock is held only for the write+flush, never
    /// across the `await`, so concurrent calls (e.g. `job.cancel` while a
    /// `job.start` is in flight) can be written without waiting for the job.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        {
            let mut stdin_slot = self.stdin.lock().unwrap();
            let Some(stdin) = stdin_slot.as_mut() else {
                self.pending.lock().unwrap().remove(&id);
                return Err("engine stdin closed".to_string());
            };
            if let Err(e) = writeln!(stdin, "{request}") {
                drop(stdin_slot);
                self.pending.lock().unwrap().remove(&id);
                return Err(format!("engine stdin write failed: {e}"));
            }
            if let Err(e) = stdin.flush() {
                drop(stdin_slot);
                self.pending.lock().unwrap().remove(&id);
                return Err(format!("engine stdin flush failed: {e}"));
            }
        }

        let response = rx.await.map_err(|_| "engine closed".to_string())?;
        if let Some(error) = response.get("error") {
            return Err(serde_json::to_string(error).unwrap_or_else(|_| error.to_string()));
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Kill the child, wait for it to exit, and drop every parked sender. Takes
    /// `&self` so callers holding an `Arc` can kill without a mutable borrow.
    pub fn kill(&self) {
        // Close stdin FIRST by taking the ChildStdin out of the mutex:
        // dropping it closes the pipe, which fires the engine watchdog
        // (`process.stdin.on("end") -> process.exit(0)`). Its exit hooks
        // kill an in-flight soffice conversion. If the engine has not
        // exited after a short grace window, kill hard as a fallback.
        drop(self.stdin.lock().unwrap().take());
        let graceful = {
            let mut child = self.child.lock().unwrap();
            let mut exited = false;
            for _ in 0..20 {
                if let Ok(Some(_)) = child.try_wait() {
                    exited = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            if !exited {
                let _ = child.kill();
                let _ = child.wait();
            }
            exited
        };
        let _ = graceful;
        self.reader.lock().unwrap().take();
        // Drop any in-flight senders even if the reader thread has not observed EOF yet.
        self.pending.lock().unwrap().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    // Writes a tiny Node mock engine that answers every request immediately
    // except `slow`, which delays. Returns the temp script path (spawn's command
    // string is whitespace-split, so the path must not contain spaces - the
    // system temp dir satisfies that on this machine).
    fn write_mock_script(name: &str) -> std::path::PathBuf {
        let script = r#"
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const respond = (result) =>
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
  if (msg.method === "slow") setTimeout(() => respond({ done: true }), 1500);
  else respond({ echo: msg.method });
});
process.stdin.on("end", () => process.exit(0));
"#;
        let path = std::env::temp_dir().join(format!("pogo-mock-{name}-{}.cjs", std::process::id()));
        std::fs::write(&path, script).expect("write mock script");
        path
    }

    fn spawn_mock(name: &str) -> EngineProcess {
        let path = write_mock_script(name);
        let cmd = format!("node {}", path.display());
        EngineProcess::spawn(&cmd, ".", |_| {}).expect("spawn mock engine")
    }

    // Critical 1: a long-running call must not block a second call, because
    // `call` takes `&self` and the stdin lock is released before the await.
    #[tokio::test]
    async fn concurrent_call_is_not_serialized_behind_in_flight_call() {
        let engine = Arc::new(spawn_mock("concurrent"));

        let slow_engine = Arc::clone(&engine);
        let slow = tokio::spawn(async move { slow_engine.call("slow", Value::Null).await });

        // Let the slow request reach the engine and park on its response.
        tokio::time::sleep(Duration::from_millis(200)).await;

        let start = Instant::now();
        let fast = engine.call("job.cancel", Value::Null).await;
        assert!(fast.is_ok(), "concurrent call failed: {fast:?}");
        assert!(
            start.elapsed() < Duration::from_millis(800),
            "concurrent call waited on the slow call (elapsed {:?})",
            start.elapsed()
        );

        slow.await.unwrap().unwrap();
        engine.kill();
    }

    // Critical 1: kill takes `&self` and must return promptly even with a call
    // in flight, so window-destroy teardown is not stalled by a running job.
    #[tokio::test]
    async fn kill_returns_promptly_while_call_in_flight() {
        let engine = Arc::new(spawn_mock("kill"));

        let slow_engine = Arc::clone(&engine);
        let slow = tokio::spawn(async move { slow_engine.call("slow", Value::Null).await });
        tokio::time::sleep(Duration::from_millis(200)).await;

        let start = Instant::now();
        engine.kill();
        assert!(
            start.elapsed() < Duration::from_millis(800),
            "kill stalled while a call was in flight (elapsed {:?})",
            start.elapsed()
        );

        // The parked call resolves with Err rather than hanging.
        assert!(slow.await.unwrap().is_err());
    }
}
