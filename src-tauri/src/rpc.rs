use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
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
    child: Child,
    stdin: ChildStdin,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Value>>>>,
    reader: Option<std::thread::JoinHandle<()>>,
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
        let parts: Vec<&str> = engine_cmd.split_whitespace().collect();
        let (program, args) = parts
            .split_first()
            .ok_or_else(|| "empty engine command".to_string())?;

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
        });

        Ok(Self {
            child,
            stdin,
            next_id: AtomicU64::new(1),
            pending,
            reader: Some(reader),
        })
    }

    /// Send a request and await its response. The engine's JSON-RPC error
    /// object is returned as a JSON string so the UI can parse `{code,message}`.
    pub async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        writeln!(self.stdin, "{request}").map_err(|e| format!("engine stdin write failed: {e}"))?;
        self.stdin
            .flush()
            .map_err(|e| format!("engine stdin flush failed: {e}"))?;

        let response = rx.await.map_err(|_| "engine closed".to_string())?;
        if let Some(error) = response.get("error") {
            return Err(serde_json::to_string(error).unwrap_or_else(|_| error.to_string()));
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.reader.take();
    }
}
