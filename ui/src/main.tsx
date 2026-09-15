import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./theme.css";

async function bootstrap() {
  // Dev screenshot harness only: ?mock=1 installs a fake Tauri host before the
  // app renders. Dynamic import keeps it out of the production bundle.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
    await import("./dev/mock-tauri");
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><App /></React.StrictMode>
  );
}

void bootstrap();
