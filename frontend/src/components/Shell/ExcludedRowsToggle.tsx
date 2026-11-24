// The app-wide "Excluded rows" display toggle (FIGURE_AUTHORING_WORKFLOW_PLAN
// F4.2c (a), owner decision 2026-09-29): one click, always visible in the
// status bar under every plot. The same preference Preferences ▸ Plot sets,
// through the same `setPref`: a view preference, so it persists but never
// enters undo history, and every XY plot window re-renders from the store at
// once (stat, polar and the Graph Builder/QFB previews do not read it).
//
// A toggle button with a CONSTANT name ("Grey excluded rows") and
// `aria-pressed` carrying the mode — the pattern that lets a screen reader say
// "pressed / not pressed" without the name itself changing under it. The
// visible glyph mirrors the pressed state for sighted users.

import { useApp } from "../../store/useApp";

export default function ExcludedRowsToggle() {
  const grey = useApp((s) => s.excludedDisplay) === "grey";
  const setPref = useApp((s) => s.setPref);
  // UX-Q: with no datasets there are no rows to exclude; keep the empty
  // project's status bar free of a control that does nothing yet.
  const hasData = useApp((s) => s.datasets.length > 0);
  if (!hasData) return null;
  return (
    <button
      type="button"
      className="qzk-status-toggle"
      aria-pressed={grey}
      // Only the XY plot windows (Stage, background windows, page cells) read
      // this; stat, polar and the Graph Builder/QFB previews do not.
      title={`Excluded rows are ${grey ? "grayed" : "hidden"} on XY plot windows only; click to ${grey ? "hide" : "gray"} them.`}
      onClick={() => setPref("excludedDisplay", grey ? "hide" : "grey")}
    >
      <span aria-hidden="true">{grey ? "◉" : "○"}</span> Gray excluded rows
    </button>
  );
}
