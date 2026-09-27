// Statistics stage — the state hook's public types, extracted from
// `useStatStage.ts` (P2.6 box 4) so the hook itself drops back under the
// 500-line module ceiling instead of carrying a grandfathered pin: the hook
// is behaviour, this file is contract. `useStatStage` re-exports every name
// here, so its importers are unchanged.

import type { GroupNotice } from "../../lib/groupAxis";
import type { StatMode } from "../../lib/statstage";
import type { Dataset } from "../../lib/types";
import type { StatStageSeed } from "../../store/useApp";
import type { StatDrawData } from "./statRender";
import type { LevelAxes } from "./statStageLevels";
import type { FacetDraw } from "./useStatStageCompute";

export interface StatColumn {
  index: number;
  label: string;
}

export interface UseStatStageParams {
  /** The dataset under analysis (the focused wrapper passes the ACTIVE
   *  dataset; a background window passes its own bound dataset). */
  active: Dataset | null;
  yKeys: number[] | null;
  xKey: number | null;
  seriesOrder: number[] | null;
  /** Graph Builder "send to stage" cross-panel seed — a FOCUSED-stage
   *  concern: the wrapper passes the live `statStageSeed`; background
   *  windows pass null (seeding always targets the focused stage). */
  seed: StatStageSeed | null;
  /** Called once a non-null `seed` has been applied (the focused wrapper
   *  passes `clearStatStageSeed`; background windows pass a no-op). */
  onSeedConsumed: () => void;
  /** P2.6 box 2 — the window's persisted `PlotView.statHideEmptyLevels` /
   *  `statShowGroupN` (defaults false / true: see `lib/plotview`). */
  hideEmptyLevels?: boolean;
  showGroupN?: boolean;
}

export interface StatStageState {
  hasData: boolean;
  mode: StatMode;
  setMode: (m: StatMode) => void;
  /** All channels (0..) — the Q-Q/Histogram value picker. */
  columns: StatColumn[];
  /** Channels that read as categorical — the Box/Violin "group by" picker. */
  categoricalCols: StatColumn[];
  /** null = "(per plotted channel)" fallback (no categorical column picked). */
  groupCol: number | null;
  setGroupCol: (i: number | null) => void;
  /** Group R — the NESTED second factor for Box/Violin/Strip: one box per
   *  (groupCol, group2Col) cell that has finite values, in nested order.
   *  null = no nesting (the ordinary one-box-per-level plot). Inert unless
   *  `groupCol` is set and names a DIFFERENT column; see
   *  `lib/statstage.maskStaleCategoricalPicks`. */
  group2Col: number | null;
  setGroup2Col: (i: number | null) => void;
  valueCol: number;
  setValueCol: (i: number) => void;
  dist: string;
  setDist: (d: string) => void;
  bins: string;
  setBins: (b: string) => void;
  fit: string | null;
  setFit: (f: string | null) => void;
  /** Bar mode only (gap #20): grouped (false, clustered side-by-side) vs
   *  stacked (true, one bar per category). */
  barStack: boolean;
  setBarStack: (s: boolean) => void;
  /** Box mode only (JMP_GAP J5 #1): overlay each group's raw finite values,
   *  jittered horizontally. Strip mode (#3) always shows points regardless
   *  of this toggle -- it has no other glyph. */
  showPoints: boolean;
  setShowPoints: (s: boolean) => void;
  /** Box/Strip (JMP_GAP J5 #2): overlay a mean +/- 95% CI diamond+whisker
   *  marker per group/category. */
  showMeanCI: boolean;
  setShowMeanCI: (s: boolean) => void;
  /** Box/Strip (JMP_GAP J5 residual): connect each group's mean with a
   *  dashed line, in on-screen category order — the "interaction plot"
   *  read. Only meaningful once a categorical "group by" column is picked
   *  (`groupCol != null`); the toolbar hides the toggle otherwise. */
  showConnectMeans: boolean;
  setShowConnectMeans: (s: boolean) => void;
  /** Box/Violin/Bar "facet by" column (GUI_INTERACTION #11) — null = no
   *  facet (the ordinary single-panel draw). Internal picker state, not a
   *  hook param: background windows never seed or set one (see the module
   *  doc). */
  facetCol: number | null;
  setFacetCol: (i: number | null) => void;
  busy: boolean;
  error: string | null;
  /** Non-fatal note (e.g. an offline degrade) shown alongside the plot. */
  note: string | null;
  /** P2.6 box 2: empty levels, small / unbalanced groups and dropped rows
   *  (`lib/groupAxis.groupNotice`), or null when there is nothing to say. */
  groupNotice: GroupNotice | null;
  draw: StatDrawData | null;
  /** Small multiples for Box/Violin/Bar (#11) — one draw per facet-column
   *  level, non-null only when `facetCol` is set AND the mode is box/violin/
   *  bar. `draw` above is null while this is non-null (a facet grid has no
   *  single flat panel) — `exportFigure` below reads THIS instead when set
   *  (GUI_INTERACTION #12 slice 4b: faceted export renders a small-multiples
   *  figure matching this same grid, server-side via `calc.figure_facets`). */
  drawFacets: FacetDraw[] | null;
  /** Builds the same-shape request the interactive stage saw, for the
   *  "Export figure" button (a no-op when there's nothing to export yet).
   *  Renders a faceted small-multiples figure when `drawFacets` is set
   *  (GUI_INTERACTION #12 slice 4b), otherwise the flat single-panel figure
   *  from `draw`. */
  exportFigure: (fmt: string) => Promise<void>;
  /** P2.6 box 4: the whole-plot category axis with the rows behind every
   *  slot (`statStageLevels.levelAxes`) — what the summary table and the
   *  plot's selection link read. Null outside the categorical modes. */
  axes: LevelAxes | null;
}
