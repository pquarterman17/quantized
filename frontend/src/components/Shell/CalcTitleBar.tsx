// Calc-only shell title bar (standalone-DiraCulator audit, 2026-08-02):
// brand + "open full app" escape hatch + connection dot + theme toggle +
// AppearanceMenu, extracted from CalcOnlyApp so each piece is testable in
// isolation without mounting the whole shell. Shares the qzk-titlebar /
// qzk-brand / qzk-tbar-right classes with the full app's TitleBar — the CSS
// chrome is shared, the two components are not.

import { useConnection } from "../../lib/lifecycle";
import { useApp } from "../../store/useApp";
import { StatusDot } from "../primitives";
import AppearanceMenu from "./AppearanceMenu";

/** window.open() the app's own origin+path WITHOUT the `?view=calc` query —
 *  the full shell (Library/Stage/Inspector/menubar) opens in a new tab. This
 *  is the escape hatch SldTab's cross-workshop "open the full app" toast now
 *  points users at. */
function openFullApp(): void {
  window.open(`${window.location.origin}${window.location.pathname}`, "_blank");
}

export default function CalcTitleBar() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  // Reuses the SAME store StatusBar's connection dot reads (lib/lifecycle) —
  // held live by main.tsx's connectLifecycle(), which every entry point
  // (App and CalcOnlyApp alike) calls before mounting either shell.
  const connected = useConnection((s) => s.connected);

  return (
    <header className="qzk-titlebar">
      <div className="qzk-brand">
        <span className="ic" style={{ color: "var(--accent)" }}>
          √
        </span>
        <span className="nm">DiraCulator</span>
      </div>
      <span
        title={connected ? "Connected" : "Offline"}
        style={{ justifySelf: "center", display: "inline-flex" }}
      >
        <StatusDot tone={connected ? "ok" : "warn"} />
      </span>
      <div className="qzk-tbar-right">
        <button
          className="qz-icon-btn"
          title="Open the full Quantized app"
          aria-label="Open the full Quantized app"
          onClick={openFullApp}
        >
          ↗
        </button>
        <button
          className="qz-icon-btn"
          title="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
        <AppearanceMenu />
      </div>
    </header>
  );
}
