use std::sync::Arc;

use serde_json::Value;

use crate::rpc::EngineProcess;

/// Managed Tauri state holding the engine sidecar.
///
/// The `RwLock<Option<Arc<EngineProcess>>>` shape is deliberate: `rpc_call`
/// takes a short read guard, clones the `Arc`, drops the guard, then awaits the
/// call. That keeps long-running `job.start` calls from serializing every other
/// RPC (notably `job.cancel`) or stalling the window-destroy kill path, which
/// takes a write guard and can immediately take the process out.
pub struct SidecarState {
    pub engine: tokio::sync::RwLock<Option<Arc<EngineProcess>>>,
}

pub fn spawn_engine(
    engine_cmd: &str,
    cwd: &str,
    on_notification: impl Fn(Value) + Send + 'static,
) -> Result<Arc<EngineProcess>, String> {
    EngineProcess::spawn(engine_cmd, cwd, on_notification).map(Arc::new)
}
