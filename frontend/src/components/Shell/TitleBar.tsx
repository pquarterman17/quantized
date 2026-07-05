// App title bar: brand · centred document title · panel + theme toggles.
// Native window owns OS chrome (no traffic-light dots), matching fermiviewer.

import { useActiveDataset, useApp } from "../../store/useApp";
import AppearanceMenu from "./AppearanceMenu";

export default function TitleBar() {
  const active = useActiveDataset();
  const toggleLeft = useApp((s) => s.toggleLeft);
  const toggleRight = useApp((s) => s.toggleRight);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const setCalculatorsOpen = useApp((s) => s.setCalculatorsOpen);

  const name = active?.name ?? "";
  const ext = name.match(/\.[^.]+$/)?.[0] ?? "";
  const stem = ext ? name.slice(0, -ext.length) : name;

  return (
    <header className="qzk-titlebar">
      <div className="qzk-brand">
        <span className="ic" style={{ color: "var(--accent)" }}>
          ⎓
        </span>
        <span className="nm">Quantized</span>
      </div>
      <div className="qzk-doc">
        {stem}
        {ext && <span className="ext">{ext}</span>}
      </div>
      <div className="qzk-tbar-right">
        <button
          className="qz-icon-btn"
          title="DiraCulator — materials calculators"
          onClick={() => setCalculatorsOpen(true)}
        >
          √
        </button>
        <button
          className="qz-icon-btn"
          title="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
        <AppearanceMenu />
        <button className="qz-icon-btn" title="Toggle library" onClick={toggleLeft}>
          ▤
        </button>
        <button className="qz-icon-btn" title="Toggle inspector" onClick={toggleRight}>
          ▥
        </button>
      </div>
    </header>
  );
}
