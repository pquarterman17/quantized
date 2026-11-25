import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { warmDefaultGraphTemplate } from "./commands/plotCommands";
import { connectLifecycle } from "./lib/lifecycle";
import { lazyRegion } from "./lib/lazyRegion";
import { isCalcOnlyView, isConvertView } from "./lib/viewMode";
import { warmSaveModules } from "./store/workspaceIOLazy";
import "./styles/index.css";

connectLifecycle();
// Prefs follow the server's prefs file (owner decision 2026-11-25); lazy, and
// never under the visual harness, whose shots must not pick up a user's theme.
if (!new URLSearchParams(window.location.search).has("harness")) {
  void import("./lib/prefsServerSync").then((m) => m.startPrefsServerSync()).catch(() => undefined);
  // Unsaved-changes warning (owner decision 2026-11-25): lazy, and not under the harness.
  void import("./lib/unsavedGuard").then((m) => m.installUnsavedGuard()).catch(() => undefined);
}
if (!isConvertView()) void warmDefaultGraphTemplate(); // gap audit 5 #1: its chunk loads only when a default is set

// ── Visual-verification seam (tools/visual) ─────────────────────────────────
// When loaded with `?harness`, `window.__qz` (the store plus the MDI helpers)
// comes from ./harnessSeam, a lazy module so none of it is in the eager
// bundle. Inert in normal use; the harness and the e2e specs wait for
// `window.__qz` before they touch it.
if (new URLSearchParams(window.location.search).has("harness")) void import("./harnessSeam");

// ── ?view=calc — standalone DiraCulator launcher (MAIN_PLAN #22) ───────────
// Read once at startup, no router: mounts the calc-only shell (calculators
// content, full-window, no Library/Stage/Inspector/menubar) instead of the
// full App shell. CalcOnlyApp is a dynamic import (P4.1, eager-bundle
// ratchet): its only caller is this rare deep-link path, but it pulls in
// CalculatorsContent's entire tab tree (SuperconductorTab, SldTab, VacuumTab,
// …) — ~136 kB of module source that every default-view user was previously
// downloading for a shell they never mount. Same `lazyRegion()` seam as
// AppOverlayPanels.tsx's lazyPanel() (UX-003: error boundary + a retry that
// recreates the lazy() promise); no Suspense fallback because the chunk is
// served from localhost and arrives in a frame or two.
const CalcOnlyApp = lazyRegion(() => import("./CalcOnlyApp"), "Calc-only view");

// /convert — the standalone Quick Convert (`qz convert --gui`, the right-click
// entry): only the converter, as a lazy chunk, so it is not in the eager bundle
// and the app's own warm-up (above and below) is skipped.
const QuickConvertPage = lazyRegion(
  () => import("./components/workshops/quickconvert/QuickConvertPage"),
  "Quick convert",
);

function Root() {
  if (isConvertView()) return <QuickConvertPage />;
  return isCalcOnlyView() ? <CalcOnlyApp /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

// Bundle slice 9 deferred Save and the `.dwk` codec; warm both once startup
// has settled so they are in hand before the first Save (workspaceIOLazy.ts).
if (!isConvertView()) setTimeout(() => void warmSaveModules(), 2_000);
