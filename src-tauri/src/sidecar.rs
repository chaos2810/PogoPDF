use serde_json::Value;

use crate::rpc::EngineProcess;

/// Managed Tauri state holding the engine sidecar. The async mutex makes it
/// sound to hold the guard across `await` inside async commands.
pub struct SidecarState {
    pub engine: tokio::sync::Mutex<Option<EngineProcess>>,
}

pub fn spawn_engine(
    engine_cmd: &str,
    cwd: &str,
    on_notification: impl Fn(Value) + Send + 'static,
) -> Result<EngineProcess, String> {
    EngineProcess::spawn(engine_cmd, cwd, on_notification)
}
