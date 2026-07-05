import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { installErrLog } from "./lib/errlog";
import { connectLifecycle } from "./lib/lifecycle";
import { useApp } from "./store/useApp";
import "./styles/index.css";

installErrLog();
connectLifecycle();

// Visual-verification seam (tools/visual): when loaded with `?harness`, expose
// the store so the headless-Chrome harness can inject datasets + plot state and
// screenshot the REAL uPlot canvas (which jsdom cannot render). Gated on the
// query param, so it is inert in normal use.
if (new URLSearchParams(window.location.search).has("harness")) {
  (window as unknown as { __qz: { useApp: typeof useApp } }).__qz = { useApp };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
