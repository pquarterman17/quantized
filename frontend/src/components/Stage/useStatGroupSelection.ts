// The Statistics stage's summary-table <-> row-selection link (P2.6 box 4):
// the React half of `statGroupSummary` — reads the app's ONE row selection
// (`store/rowState.selection`, honoured only while it names the dataset on
// the stage), turns table / plot gestures into `setRowSelection`, and puts
// the resulting marks onto the draws the canvas paints.
//
// The local pick (empty groups' selected state, see statGroupSummary's
// header) is DROPPED during render the moment the store's selection stops
// being the object the pick produced, or the axis it was made on is replaced
// (new picks, a dataset switch, an exclusion, a data edit) — React's
// "adjust state when a prop changes" pattern, as `peakSelection` uses, so no
// frame and no event ever sees a stale pick. Dropped rather than merely
// ignored: a selection that later returns to the same value (null again,
// after a worksheet brush and a clear) must not resurrect it.

import { useCallback, useMemo, useRef, useState } from "react";

import { columnOf } from "../../lib/categorical";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import {
  applyGesture,
  buildGroupSummary,
  selectedCount,
  selectionMarks,
  toAnalysisRows,
  visibleSummaryRows,
  type GestureMods,
  type GroupPick,
  type GroupSummary,
  type SummaryRow,
} from "./statGroupSummary";
import type { StatDrawData } from "./statRender";
import type { LevelAxes } from "./statStageLevels";
import type { FacetDraw } from "./useStatStageCompute";

const NONE: ReadonlySet<string> = new Set();
const NO_ROWS: readonly number[] = [];

export interface StatGroupSelection {
  summary: GroupSummary | null;
  /** The table's rows, in axis order (the plot's visible slots). */
  visible: SummaryRow[];
  /** Per `visible` row, how many of its rows are selected. */
  counts: number[];
  /** `aria-selected` for a visible row: every row selected, or (an empty
   *  group) picked by the last gesture. */
  isSelected: (row: SummaryRow) => boolean;
  /** A table / plot gesture on the group `key`; `panel` scopes it to one
   *  facet panel's rows; `anchorHint` seeds a keyboard range. */
  select: (key: string, mods: GestureMods, panel?: string, anchorHint?: string) => void;
  clear: () => void;
  /** The draws with the selection marks attached (same objects when there is
   *  nothing to mark). */
  decorate: (draw: StatDrawData | null) => StatDrawData | null;
  decorateFacets: (facets: FacetDraw[] | null) => FacetDraw[] | null;
}

function withMarks(draw: StatDrawData, marks: ReturnType<typeof selectionMarks>): StatDrawData {
  if (draw.mode === "qq" || draw.mode === "histogram") return draw;
  return marks ? { ...draw, selection: marks } : draw;
}

export function useStatGroupSelection(
  active: Dataset | null,
  axes: LevelAxes | null,
  hideEmpty: boolean,
): StatGroupSelection {
  const selection = useApp((s) => s.selection);
  const setRowSelection = useApp((s) => s.setRowSelection);
  const clearRowSelection = useApp((s) => s.clearRowSelection);

  const summary = useMemo(() => (active && axes ? buildGroupSummary(active, axes) : null), [active, axes]);
  const visible = useMemo(() => (summary ? visibleSummaryRows(summary, hideEmpty) : []), [summary, hideEmpty]);
  const byKey = useMemo(() => new Map(visible.map((r) => [r.key, r] as const)), [visible]);
  const liveRows = active && selection?.datasetId === active.id ? selection.rows : NO_ROWS;
  const selected = useMemo(() => new Set(liveRows), [liveRows]);

  const [pick, setPick] = useState<GroupPick | null>(null);
  if (pick && (pick.basis !== selection || pick.summary !== summary)) setPick(null);
  const picked = pick && pick.basis === selection && pick.summary === summary ? pick.keys : NONE;
  const anchor = useRef<string | null>(null);

  const counts = useMemo(() => visible.map((r) => selectedCount(r, selected)), [visible, selected]);
  const countOf = useMemo(() => new Map(visible.map((r, i) => [r.key, counts[i]] as const)), [visible, counts]);

  const panelScope = useCallback(
    (panel: string | undefined): ((r: number) => boolean) | undefined | null => {
      if (panel === undefined) return undefined;
      const code = axes?.facetCodeOf?.get(panel);
      if (!active || axes?.facetCol == null || code === undefined) return null;
      const facet = columnOf(active.data, axes.facetCol);
      return (r) => facet[r] === code;
    },
    [active, axes],
  );

  const select = useCallback(
    (key: string, mods: GestureMods, panel?: string, anchorHint?: string) => {
      const scope = panelScope(panel);
      if (!summary || scope === null) return;
      // The range anchor: the last plain / toggle gesture's group while it is
      // still on the table, else the keyboard's starting row. A range never
      // moves it; anything else (or a range with no usable anchor, which
      // `applyGesture` treats as a plain pick) re-seats it.
      const known = (k: string | null | undefined): k is string => k != null && byKey.has(k);
      const from = known(anchor.current) ? anchor.current : known(anchorHint) ? anchorHint : null;
      const g = applyGesture(visible, key, mods, from, liveRows, picked, scope);
      if (!g) return;
      anchor.current = mods.range && from != null ? from : key;
      setRowSelection(g.rows);
      setPick({ keys: new Set(g.keys), basis: useApp.getState().selection, summary });
    },
    [summary, visible, byKey, liveRows, picked, panelScope, setRowSelection],
  );

  const clear = useCallback(() => {
    anchor.current = null;
    clearRowSelection();
    setPick(null);
  }, [clearRowSelection]);

  const isSelected = useCallback(
    (row: SummaryRow) => (row.n > 0 ? countOf.get(row.key) === row.n : picked.has(row.key)),
    [countOf, picked],
  );

  const hasAny = selected.size > 0 || picked.size > 0;
  const decorate = useCallback(
    (draw: StatDrawData | null): StatDrawData | null => {
      if (!draw || !hasAny || !active) return draw;
      const hasPoints = (draw.mode === "box" && draw.points) || draw.mode === "strip";
      const points = hasPoints ? toAnalysisRows(active, liveRows) : new Set<number>();
      const slots = "slots" in draw ? draw.slots : null;
      return withMarks(draw, selectionMarks(slots, byKey, selected, picked, points));
    },
    [hasAny, active, liveRows, byKey, selected, picked],
  );

  const decorateFacets = useCallback(
    (facets: FacetDraw[] | null): FacetDraw[] | null => {
      if (!facets || !hasAny) return facets;
      return facets.map((f) => {
        const scope = panelScope(f.label);
        const slots = "slots" in f.draw ? f.draw.slots : null;
        if (!scope) return f;
        return { ...f, draw: withMarks(f.draw, selectionMarks(slots, byKey, selected, picked, new Set(), scope)) };
      });
    },
    [hasAny, panelScope, byKey, selected, picked],
  );

  return { summary, visible, counts, isSelected, select, clear, decorate, decorateFacets };
}
