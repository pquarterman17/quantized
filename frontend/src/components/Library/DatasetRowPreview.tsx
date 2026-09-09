// UX-001: the Library TREE's compact worksheet row no longer mounts a
// Sparkline unconditionally (that was the always-mounted-card problem —
// DatasetRow.tsx's header used to note "~120+ mount at once"). This owns the
// opt-in disclosure: a small toggle button that mounts/unmounts the SAME
// Sparkline component Tiles' richer preview does not touch, persisting the
// per-row expanded state via lib/libraryPreviewPrefs (same localStorage-blob
// convention as libraryViewPrefs.ts — personal UI state, not project
// content). Toggling never selects the row or changes the active plot: the
// button stops propagation on BOTH click and dblclick, so the row's own
// onClick/onDoubleClick never see either.
//
// Self-contained on purpose (LIBRARY_WORKBOOK_UX_PLAN interaction checklist:
// "optional inline thumbnail expansion without changing selection or opening
// a plot") so DatasetRow.tsx only needs to mount it, not thread expand state
// through its own props/hooks — keeps it under the component ceiling.

import { useState } from "react";

import { isPreviewExpanded, setPreviewExpanded } from "../../lib/libraryPreviewPrefs";
import type { Dataset } from "../../lib/types";
import Sparkline from "./Sparkline";

export default function DatasetRowPreview({ dataset: d }: { dataset: Dataset }) {
  const [expanded, setExpanded] = useState(() => isPreviewExpanded(d.id));
  // A still-pending dataset only carries the small downsampled preview on
  // `.data` until first opened (DatasetRow's "#38" comment) — that preview
  // IS what Sparkline draws from, so this stays enabled either way; nothing
  // extra to fetch.
  const label = expanded ? "Hide preview" : "Show preview";
  return (
    // A Fragment, not a wrapping element: the toggle button stays a normal
    // inline item on the compact row's single line, while the (optional)
    // Sparkline is its own direct flex child of that row with its own
    // `flex-basis: 100%` (shell.css) — so it wraps onto a full-width line
    // of its own directly below, rather than squeezing in next to the name/
    // meta text or requiring a second nesting level flexbox can't span.
    <>
      <button
        type="button"
        className="qz-icon-btn"
        title={label}
        aria-label={label}
        aria-pressed={expanded}
        // Review round: stopping `click` alone was NOT enough. A quick
        // expand-then-collapse is a DOUBLE click, and `dblclick` is a separate
        // event that bubbled straight to the row's `onDoubleClick` and opened
        // the dataset — precisely the one thing this control promises never to
        // do. Confirmed by probe: `activeId` became the dataset's id.
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const next = !expanded;
          setExpanded(next);
          setPreviewExpanded(d.id, next);
        }}
      >
        ∿
      </button>
      {expanded && (
        <span className="qzk-ds-spark-wrap">
          <Sparkline data={d.data} />
        </span>
      )}
    </>
  );
}
