// App title bar: brand · centred document title · panel + theme toggles.
// Native window owns OS chrome (no traffic-light dots), matching fermiviewer.

import { useEffect } from "react";

import * as GLYPHS from "../../lib/glyphs";
import { toggleInspector } from "../../store/inspectorToggle";
import { useApp } from "../../store/useApp";
import { useShownDataset } from "../../store/useShownDataset";
import AppearanceMenu from "./AppearanceMenu";

export default function TitleBar() {
  const active = useShownDataset(); // the dataset the Stage shows (worksheet tab: worksheetId)
  const toggleLeft = useApp((s) => s.toggleLeft);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const setCalculatorsOpen = useApp((s) => s.setCalculatorsOpen);
  // P1.2 box 1: project name + dirty marker. Only rendered once a project
  // has a durable identity (a native open/save) — a fresh/browser-only
  // session has nothing named yet, so the brand area stays exactly as it
  // was pre-P1.2 rather than showing a synthetic "Untitled".
  const currentProject = useApp((s) => s.currentProject);
  const projectDirty = useApp((s) => s.projectDirty);
  // A browser tab has no path, but it knows the .dwk it opened or saved.
  const browserFile = useApp((s) => s.browserFileName);
  const hasData = useApp((s) => s.datasets.length > 0);
  const projectName = currentProject?.name ?? browserFile;
  // UX10-D (provisional, owner to confirm): data with no file name yet is an
  // "Untitled workspace", and it is unsaved by definition (autosave only keeps
  // recovery points), so the title bar still names the project and flags it.
  const shownName = projectName ?? (hasData ? "Untitled workspace" : undefined);
  const shownDirty = projectName ? projectDirty : hasData;
  // The window/tab title carries the same name and dirty marker.
  useEffect(() => {
    document.title = shownName ? `${shownDirty ? "• " : ""}${shownName} — Quantized` : "Quantized";
  }, [shownName, shownDirty]);

  const name = active?.name ?? "";
  const ext = name.match(/\.[^.]+$/)?.[0] ?? "";
  const stem = ext ? name.slice(0, -ext.length) : name;

  return (
    <header className="qzk-titlebar">
      <div className="qzk-brand">
        <span className="ic" style={{ color: "var(--accent)" }}>
          {GLYPHS.brand}
        </span>
        <h1 className="nm">Quantized</h1>
      </div>
      {/* UX9-I: the centred title names the PROJECT once it has one; the shown
          dataset follows it, dimmed (before, only the dataset was centred). */}
      <div className="qzk-doc">
        {shownName && (
          <span className="qzk-project" title={currentProject?.path ?? (projectName ? shownName : "Not saved to a file yet")}>
            {shownName}
            {shownDirty && <span className="qzk-project-dirty" role="img" aria-label="unsaved changes"> •</span>}
          </span>
        )}
        {shownName && stem && <span className="ext"> — </span>}
        {stem}
        {ext && <span className="ext">{ext}</span>}
      </div>
      <div className="qzk-tbar-right">
        <button
          aria-label="Calculators"
          className="qz-icon-btn"
          title="DiraCulator — materials calculators"
          onClick={() => setCalculatorsOpen(true)}
        >
          {GLYPHS.calculators}
        </button>
        <button
          aria-label="Theme"
          className="qz-icon-btn"
          title="Toggle theme (Ctrl+Shift+L)"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? GLYPHS.themeDark : GLYPHS.themeLight}
        </button>
        <AppearanceMenu />
        <button aria-label="Library" className="qz-icon-btn" title="Toggle library" onClick={toggleLeft}>
          {GLYPHS.libraryToggle}
        </button>
        <button aria-label="Inspector" className="qz-icon-btn" title="Toggle inspector" onClick={toggleInspector}>
          {GLYPHS.inspectorToggle}
        </button>
      </div>
    </header>
  );
}
