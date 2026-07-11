// Calc-only shell (MAIN_PLAN #22 — the standalone DiraCulator launcher).
// Mounted instead of App when the URL carries ?view=calc (main.tsx reads
// isCalcOnlyView() once at startup — no router). Renders JUST the
// calculators content full-window: no Library/Stage/Inspector/menubar. The
// theme/accent/density data-* attrs on <html> still apply — that sync is a
// module-level side effect of importing store/useApp (syncPrefs runs at
// import time), which every component here pulls in transitively.

import CalculatorsContent from "./components/workshops/calculators/CalculatorsContent";
import Toaster from "./components/overlays/Toaster";
import { useApp } from "./store/useApp";

export default function CalcOnlyApp() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);

  return (
    <div className="qzk-calc-app">
      <header className="qzk-titlebar">
        <div className="qzk-brand">
          <span className="ic" style={{ color: "var(--accent)" }}>
            √
          </span>
          <span className="nm">DiraCulator</span>
        </div>
        <div />
        <div className="qzk-tbar-right">
          <button
            className="qz-icon-btn"
            title="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☾" : "☀"}
          </button>
        </div>
      </header>
      <main className="qzk-calc-body">
        <CalculatorsContent />
      </main>
      <Toaster />
    </div>
  );
}
