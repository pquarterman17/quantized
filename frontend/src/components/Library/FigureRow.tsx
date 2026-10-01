// One recovered Origin graph as a clickable Library row: click restores the
// figure's axis ranges + log flags to its bound dataset. An entry whose loose
// source reference didn't resolve to any imported book renders disabled, with
// the reason in its tooltip (never guesses at the wrong book). Shared by the
// flat FiguresSection (no-folders mode) and the folder tree, where the figure
// nests under its project folder at `depth` (plan item 5). The "⊞" button
// (item 9, MULTI_PLOT_PLAN) opens the SAME apply into a brand-new window
// instead of overwriting the focused one — the payoff for an `.opj` import
// with many graph windows.

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { plural } from "../../lib/plural";

import { recordWorkbookOpen } from "./libraryOpen";
import { LIBRARY_NODE_GLYPH, LIBRARY_NODE_LABEL } from "./nodeIcons";
import { originFidelityLabel, originFidelityStatusLabel } from "../../lib/originFidelity";
import { figureLabel, type OriginFigureEntry } from "../../lib/originFigures";
import { originPreviewDataUrl } from "../../lib/originPreview";
import { resolveOriginFigureSources } from "../../lib/originSources";
import { useApp } from "../../store/useApp";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";
import { innerTabIndex, spaceActivates, type TreeItemProps } from "../../lib/libraryTreeNav";
import { lazyRegion } from "../../lib/lazyRegion";

/** The saved-preview ToolWindow renders only after the "▣" button is clicked,
 *  and nothing else in the entry graph imported it — so a static import here
 *  put the window, `components/overlays/ToolWindow.tsx` and `lib/workshopHelp.ts`
 *  in the eager bundle for a control most sessions never press. `lazyRegion`
 *  (UX-003's error boundary + retry) is the same shape `Library.tsx` already
 *  uses for `EditableFiguresSection` and `AppOverlays.tsx`'s `lazyPanel()`
 *  uses for every on-demand panel: the row itself, its glyph button and the
 *  toggle are untouched and still eager, so the ONLY difference is that the
 *  window paints one chunk-fetch later the first time it is opened in a
 *  session. Measured: 917,136 -> 912,461 B eager. */
const OriginSavedPreviewWindow = lazyRegion(() => import("./OriginSavedPreviewWindow"), "Preview");

export default function FigureRow({ entry, depth = 0, treeMode = false, treeItem }: {
  entry: OriginFigureEntry;
  depth?: number;
  /** L0.25 (PR #139 review) — set by LibraryTree only: single click SELECTS
   *  (librarySelection, visible highlight), double-click/Enter opens;
   *  right-click selects. Unset (flat FiguresSection): the established
   *  click-applies behavior is unchanged. The ⊞/▤/G/▣ buttons keep their
   *  one-click actions in both modes — they're commands, not the row. */
  treeMode?: boolean;
  /** LibraryTree's treeitem semantics + roving tab stop (U5); the action
   *  buttons leave the Tab sequence unless this is the roving row. The
   *  treeitem is the WHOLE row (name + action strip), so the strip's buttons
   *  are owned by their treeitem rather than sitting loose between items. */
  treeItem?: TreeItemProps;
}) {
  const applyOriginFigure = useApp((s) => s.applyOriginFigure);
  const openOriginFigureSource = useApp((s) => s.openOriginFigureSource);
  const remakeOriginFigure = useApp((s) => s.remakeOriginFigure);
  const figures = useApp((s) => s.originFigures);
  const datasets = useApp((s) => s.datasets);
  const selection = useLibraryStore((s) => s.librarySelection);
  const selected = treeMode && selection?.kind === "origin-figure" && selection.id === entry.id;
  const select = () => useApp.getState().setLibrarySelection({ kind: "origin-figure", id: entry.id });
  const sourceResolution = resolveOriginFigureSources(entry, figures, datasets);
  // PR C: the workbook owning this figure's bound dataset, for L0.6's
  // remembered-child recording — undefined when unresolved or unowned
  // (a cross-workbook/root placement never "remembers" a single workbook).
  const ownerWorkbookId = datasets.find((ds) => ds.id === entry.datasetId)?.workbookId;
  const openAndRemember = (opts?: { newWindow?: boolean }) => {
    applyOriginFigure(entry.id, opts);
    recordWorkbookOpen(ownerWorkbookId, `origin-figure:${entry.id}`);
  };
  const [showSavedPreview, setShowSavedPreview] = useState(false);
  const savedPreviewSrc = originPreviewDataUrl(entry.figure.saved_preview);
  const previewActionLabel = showSavedPreview
    ? "Close saved Origin preview"
    : "Open saved Origin preview for comparison";
  const siblingDatasets = datasets.filter((ds) => entry.siblingIds.includes(ds.id));
  const resolved = entry.datasetId != null;
  const inner = innerTabIndex(treeItem);
  // V1: in the tree the name part is a <div> (ARIA-in-HTML bars treeitem on a
  // <button>), and the treeitem is the row wrapper that also holds the action
  // strip, so its buttons sit inside their item. Space on the row selects as
  // the button's did; Enter is the tree's. A click on an action is that
  // command only, never also the row's select/open.
  const Anchor = treeItem ? "div" : "button";
  const onAction = (e: MouseEvent): boolean => (e.target as Element).closest(".qzk-origin-figure-actions") != null;
  const treeRowProps = treeItem && {
    ...treeItem,
    "data-lib-row": `origin-figure:${entry.id}`,
    // An unresolved graph stays FOCUSABLE (aria-disabled, U5): a disabled
    // button can't take focus, so arrows would skip it. Open is a no-op.
    "aria-disabled": !resolved ? true : undefined,
    onClick: (e: MouseEvent) => { if (!onAction(e)) select(); },
    onDoubleClick: (e: MouseEvent) => { if (!onAction(e)) openAndRemember(); },
    onContextMenu: select,
    onKeyDown: (e: KeyboardEvent) => { if (e.target === e.currentTarget) spaceActivates(e, select); },
  };
  const n = entry.figure.n_curves;
  const fidelity = entry.figure.fidelity;
  const fidelityText = fidelity
    ? `${originFidelityStatusLabel(fidelity.status)}; missing ${fidelity.omissions.map(originFidelityLabel).join(", ")}`
    : "Fidelity not assessed";
  const title = resolved
    ? `${entry.stem} — restore axis ranges (${n} curve${plural(n)}); ${fidelityText}`
    : `unresolved source "${entry.figure.source_hint || "unknown"}" — no matching imported book`;
  return (
    <div className="qzk-origin-figure-row">
      <div
        className={`qzk-fig-row${treeMode ? " qzk-fig-row-tree" : ""}${selected ? " selected" : ""}${!resolved ? " unresolved" : ""}`}
        style={treeMode && depth ? { paddingLeft: depth * 14 } : undefined}
        {...treeRowProps}
      >
        <Anchor
          className={`qzk-fig-item${selected ? " selected" : ""}`}
          title={title}
          style={!treeMode && depth ? { marginLeft: depth * 14 } : undefined}
          {...(treeItem ? {} : {
            "data-lib-row": `origin-figure:${entry.id}`,
            disabled: !resolved && !treeMode,
            "aria-disabled": !resolved && treeMode ? true : undefined,
            onClick: () => (treeMode ? select() : openAndRemember()),
            onDoubleClick: treeMode ? () => openAndRemember() : undefined,
            onContextMenu: treeMode ? select : undefined,
          })}
        >
          {/* Node-type glyph (UX-001), from the one shared vocabulary
           *  (UX-004) every Library view now reads. */}
          <span className="qzk-ds-icon" aria-hidden="true" title={LIBRARY_NODE_LABEL["origin-figure"]}>
            {LIBRARY_NODE_GLYPH["origin-figure"]}
          </span>
          <span className="qzk-origin-kind" title="Recovered Origin graph">Graph</span>
          <span className="qzk-fig-name">{figureLabel(entry)}</span>
          <span className="qzk-fig-meta">
            {entry.stem}{fidelity ? ` · ${fidelity.status === "exact" ? "=" : "≈"}` : ""}
          </span>
        </Anchor>
        <div
          className="qzk-origin-figure-actions"
          // A named group outside a tree; inside one, role=group would claim
          // to own child treeitems, which these buttons are not.
          role={treeItem ? undefined : "group"}
          aria-label={treeItem ? undefined : "Recovered graph actions"}
        >
          <button
            className="qz-icon-btn"
            tabIndex={inner}
            title="Open in a new graph window"
            aria-label="Open in a new graph window"
            disabled={!resolved}
            onClick={() => openAndRemember({ newWindow: true })}
          >
            ⊞
          </button>
          {sourceResolution.sources.map((source) => (
            <button
              key={source.datasetId}
              className="qz-icon-btn"
              tabIndex={inner}
              title={`Open source workbook ${source.book}; select X/Y/error columns`}
              aria-label={`Open source workbook ${source.book}`}
              onClick={() => void openOriginFigureSource(entry.id, source.datasetId)}
            >
              {/* This command NAMES a node kind ("open the source workbook"), so
               *  it deliberately wears that kind's mark rather than inventing one.
               *  It used to wear ▦ — which meant Folder in the very same tree
               *  (UX-004). */}
              {LIBRARY_NODE_GLYPH.workbook}
            </button>
          ))}
          <button
            className="qz-icon-btn"
            tabIndex={inner}
            title={sourceResolution.sources.length
              ? `Remake in Graph Builder${sourceResolution.unresolved.length ? ` (${sourceResolution.unresolved.length} unresolved binding${plural(sourceResolution.unresolved.length)})` : ""}`
              : `No decoded bindings; Origin hint: ${entry.figure.source_hint || "unknown"}`}
            aria-label="Remake in Graph Builder"
            disabled={sourceResolution.sources.length === 0}
            onClick={() => void remakeOriginFigure(entry.id)}
          >
            G
          </button>
          {savedPreviewSrc && (
            <button
              className="qz-icon-btn"
              tabIndex={inner}
              title={previewActionLabel}
              aria-label={previewActionLabel}
              aria-pressed={showSavedPreview}
              onClick={() => setShowSavedPreview((shown) => !shown)}
            >
              ▣
            </button>
          )}
          {sourceResolution.unresolved.length > 0 && siblingDatasets.length > 0 && (
            <select
              className="qz-select"
              tabIndex={inner}
              aria-label={`Choose source workbook for ${figureLabel(entry)}`}
              title={`Unresolved Origin binding: ${sourceResolution.unresolved.map((item) => `${item.book}:${item.x},${item.y}`).join("; ")}`}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) void openOriginFigureSource(entry.id, event.target.value, { manual: true });
                event.currentTarget.value = "";
              }}
            >
              <option value="" disabled>Choose source…</option>
              {siblingDatasets.map((ds) => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
            </select>
          )}
        </div>
      </div>
      {showSavedPreview && savedPreviewSrc && (
        <OriginSavedPreviewWindow
          entry={entry}
          src={savedPreviewSrc}
          onClose={() => setShowSavedPreview(false)}
        />
      )}
    </div>
  );
}
