// The app-wide "Excluded rows" display toggle (FIGURE_AUTHORING_WORKFLOW_PLAN
// F4.2c (a), owner decision 2026-09-29): one click, always visible in the
// status bar under every plot. The same preference Preferences ▸ Plot sets,
// through the same `setPref`: a view preference, so it persists but never
// enters undo history, and every plot re-renders from the store at once.
//
// A toggle button with a CONSTANT name ("Grey excluded rows") and
// `aria-pressed` carrying the mode — the pattern that lets a screen reader say
// "pressed / not pressed" without the name itself changing under it. The
// visible glyph mirrors the pressed state for sighted users.

import { useApp } from "../../store/useApp";

export default function ExcludedRowsToggle() {
  const grey = useApp((s) => s.excludedDisplay) === "grey";
  const setPref = useApp((s) => s.setPref);
  return (
    <button
      type="button"
      className="qzk-status-toggle"
      aria-pressed={grey}
      title={`Excluded rows are ${grey ? "greyed" : "hidden"} on every plot; click to ${grey ? "hide" : "grey"} them.`}
      onClick={() => setPref("excludedDisplay", grey ? "hide" : "grey")}
    >
      <span aria-hidden="true">{grey ? "◉" : "○"}</span> Grey excluded rows
    </button>
  );
}
