# Origin workbook and Graph Builder fallback

Origin decode plan item #50 adds a loss-aware escape hatch for every imported
graph whose curve bindings were decoded.

## Library actions

Each actionable Origin figure row now provides:

- one source-workbook button per participating book; it resolves lazy data,
  opens the exact imported pseudo-book in the Worksheet tab, and selects the
  decoded X, Y, and paired Y-error columns;
- **G**, which applies the recovered figure state and opens Graph Builder with
  the decoded curve wells prefilled;
- a manual workbook picker when any raw `book:x,y` binding did not resolve.
  The picker is explicit authority from the user: automatic matching remains
  scoped to the original import siblings and never substitutes a same-named
  book from another project.

Source buttons follow Origin layer and curve order. A cross-book graph exposes
every participating workbook separately. Lazy source fetches complete before
either action proceeds, so the worksheet and remake path never use the import
preview in place of full data.

## Graph Builder behavior

For a single-book layer, the seed references the imported dataset and decoded
X/Y channels directly. An Origin time/X column is represented by Graph
Builder's empty X well, which is its native contract for the pinned time axis.

For a layer whose curves span books, the action first uses the ordinary Origin
figure-apply path. That path creates or reuses the provenance-stamped overlay
dataset (`origin_overlay_source=<figure entry id>`), and Graph Builder receives
the overlay channels in Origin curve order. It does not create a second remake
overlay.

The same overlay rule applies to a single worksheet containing multiple X
blocks (`X,Y,X,Y,...`). Each Y keeps its decoded per-curve X binding from the
import pipeline; Graph Builder receives the segmented overlay produced by
`applyOriginFigure`, not the worksheet's first X column. This preserves
non-monotonic sweep order and prevents remaking a corrected hysteresis figure
into the pre-PR-38 smeared geometry.

Applying first also restores every already-supported property—axis limits and
scales, decoded steps and titles, series styles and labels, legend placement,
annotations, regions, double-Y state, and spatial panels—before the editable
channel seed opens. PlotSpec v1 itself is single-dataset and single-layer, so a
multi-panel page opens the clicked layer in Graph Builder while the full
recovered page remains applied on the stage. This limitation is disclosed; it
is not encoded as a fictitious mixed-dataset PlotSpec.

## Unresolved bindings

Automatic resolution requires an exact decoded Origin book name inside the
entry's `siblingIds`, plus decoded X/Y letters in that book. Failures retain the
raw Origin book and column letters with one of these reasons:

- `book_not_imported`
- `x_column_not_decoded`
- `y_column_not_decoded`

The manual picker deliberately ignores only the raw book-name mismatch after
the user chooses a sibling workbook. It still requires the raw column letters
to exist in that workbook and never invents a column. If they do not, the
action remains unavailable and reports the original hint.

## Review and tests

Review centers:

- `frontend/src/lib/originSources.ts` — pure exact/manual binding contract;
- `frontend/src/store/originFallback.ts` — lazy resolution and UI handoff;
- `frontend/src/components/Library/FigureRow.tsx` — source/remake actions;
- `frontend/src/components/Stage/worksheet/useWorksheetView.ts` — one-shot
  exact column selection.

Tests cover sibling-import isolation, cross-book ordering, error-column
selection, unresolved raw diagnostics, explicit manual resolution, worksheet
handoff, direct Graph Builder seeding, and cross-book overlay reuse.
