import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LangProvider } from "./app/LangProvider";
import { ThemeProvider } from "./app/ThemeProvider";
import { Router } from "./app/router";
import { callEngine } from "./app/rpc";

/**
 * The app boots behind a borderless splash window (see splash.html and the
 * `splash` window in tauri.conf.json). Once the React app mounts and the
 * engine answers engine.ping, the real work is ready: tell the shell to swap
 * the splash for the main window. In mock mode (?mock=1 in dev) there is no
 * engine, so the swap fires immediately.
 */
function useSplashHandoff() {
  useEffect(() => {
    let cancelled = false;
    const handoff = async () => {
      if (new URLSearchParams(window.location.search).has("mock")) {
        await invoke("startup_complete").catch(() => undefined);
        return;
      }
      try {
        await callEngine("engine.ping");
        if (!cancelled) await invoke("startup_complete");
      } catch {
        // Engine not up yet: the splash keeps showing while we retry.
        setTimeout(() => void handoff(), 400);
      }
    };
    void handoff();
    return () => {
      cancelled = true;
    };
  }, []);
}

export default function App() {
  useSplashHandoff();
  return (
    <LangProvider>
      <ThemeProvider>
        <Router />
      </ThemeProvider>
    </LangProvider>
  );
}