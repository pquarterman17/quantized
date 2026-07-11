// Wire types mirroring the FastAPI backend payloads (src/quantized/routes).

import type { ColormapName } from "./colormap";

/** DataStruct as serialized by `datastruct_payload` / `DataStruct.to_dict`. */
export interface DataStruct {
  time: number[];
  values: number[][]; // row-major: values[row][channel]
  labels: string[];
  units: string[];
  metadata: Record<string, unknown>;
  /** Origin projects only: every workbook, when the file holds more than one.
   *  Each entry is EITHER a full `DataStruct` (the `full_books=true` escape
   *  hatch, or any entry under it) OR one of the two lazy-transport shapes
   *  below (ORIGIN_FILE_DECODE_PLAN #38, the default) — see `BookEntry`. */
  books?: BookEntry[];
  /** Present alongside a lazy `books[]` (absent under `full_books=true`): the
   *  reference `POST /api/parsers/books/data` needs (with a book's `id`) to
   *  fetch that book's full data on its first activation in the UI. */
  book_source?: BookSourceRef;
  /** Origin `.opj` projects only: every graph window as a plot-state snapshot
   *  (`figures.extract_figures`, plan items 12/13/18). `.opju` figures are not
   *  extracted yet (item 14). */
  figures?: OriginFigure[];
}

/** The `books[]` entry for the book already returned in full at the payload's
 *  top level (ORIGIN_FILE_DECODE_PLAN #38) — carries no data of its own; the
 *  frontend builds this book's Dataset from the top-level payload instead. */
export interface PrimaryBookMarker {
  lazy: false;
  primary: true;
  id: string;
  labels: string[];
  units: string[];
  metadata: Record<string, unknown>;
  rows: number;
  cols: number;
}

/** A non-primary book's lightweight inventory entry (ORIGIN_FILE_DECODE_PLAN
 *  #38): real labels/units/metadata (so the Library folder tree, tags, and
 *  book name all resolve immediately) plus a downsampled preview series (so
 *  a Library sparkline renders without the full column data) — never the
 *  full `time`/`values`. `rows`/`cols` are the TRUE (pre-decimation) counts. */
export interface LazyBookEntry {
  lazy: true;
  id: string;
  labels: string[];
  units: string[];
  metadata: Record<string, unknown>;
  rows: number;
  cols: number;
  preview: { time: number[]; values: number[][] };
}

/** One `books[]` entry: a full `DataStruct` (under the `full_books=true`
 *  escape hatch), the primary book's marker, or another book's lazy preview. */
export type BookEntry = DataStruct | PrimaryBookMarker | LazyBookEntry;

/** `DataStruct.book_source` — the PROJECT-level reference (no book id yet;
 *  combine with a `BookEntry`'s `id` to get the per-dataset `BookSource`
 *  a pending `Dataset` carries — see `types.ts`'s `BookSource`). */
export interface BookSourceRef {
  kind: "path" | "upload";
  path?: string;
  token?: string;
}

/** A pending `Dataset`'s fetch reference: `POST /api/parsers/books/data`'s
 *  request body once `book_id: bookId` is added — everything `api.fetchBookData`
 *  needs to retrieve this ONE book's full data. `rows`/`cols` are carried
 *  along (from the `LazyBookEntry` this was built from) purely for display —
 *  so a Library row can show the book's TRUE size while `data` is still just
 *  the small preview. */
export interface BookSource extends BookSourceRef {
  bookId: string;
  rows: number;
  cols: number;
}

export function isLazyBookEntry(b: BookEntry): b is LazyBookEntry {
  return (b as LazyBookEntry).lazy === true;
}

export function isPrimaryBookMarker(b: BookEntry): b is PrimaryBookMarker {
  return (b as PrimaryBookMarker).primary === true;
}

/** One graph window recovered from an Origin project — a plot-state snapshot:
 *  axis ranges + log-scale heuristic, a loose source reference (Origin's graph
 *  windows don't carry an exact curve->column selector, see
 *  `docs/origin_re/opj_figures.md`), a curve count, and surviving annotation
 *  text (titles, peak labels). Matched to an imported dataset client-side
 *  (`lib/originFigures.resolveFigureDataset`). */
/** One decoded curve->column binding of an Origin graph (`.opju` only —
 *  opju_curves; 100% oracle-precision, partial recall, so a figure may carry
 *  fewer curves than it really plots, or none). Letters are Origin column
 *  short names ("A", "B", ...). */
export interface OriginCurve {
  book: string;
  x: string;
  y: string;
  /** Plot style decoded from the curve's style record: "line" (Origin
   *  plot:=200) or "scatter" (plot:=201). Absent when the importer couldn't
   *  recover it (unmapped bytes, e.g. Origin's line+symbol) — the default
   *  trace then stands. */
  style?: "line" | "scatter";
  /** Origin's plot color as "#RRGGBB", decoded from the curve style record
   *  (io/origin_project/curve_style_color.py: direct-RGB and classic-palette
   *  ocolors). Absent for "auto/increment" colors and anything undecodable —
   *  the palette default then stands, never a guessed color. */
  color?: string;
  /** Origin's symbol shape (gallery kinds 1-8 mapped to MarkerShape names:
   *  square/circle/triangle/...). Absent when the plot has no symbols or the
   *  kind is unmapped. */
  symbol?: string;
  /** Not currently emitted: Origin's on-disk line-width/symbol-size fields
   *  failed oracle verification (scaled-graph cases), so the backend omits
   *  them rather than ship wrong values. Typed so a future decode flows. */
  lineWidth?: number;
  symbolSize?: number;
}

export interface OriginFigure {
  name: string;
  x_from: number;
  x_to: number;
  x_log: boolean;
  y_from: number;
  y_to: number;
  y_log: boolean;
  source_hint?: string;
  n_curves: number;
  annotations: string[];
  /** Positioned floating text (Origin Text objects) at DATA coordinates —
   *  the text box's top-left corner, multi-line text "\n"-joined. Only
   *  objects whose position decoded are listed (never guessed); the same
   *  text also appears (per line) in `annotations`. Applied to the store's
   *  plot `annotations` by applyOriginFigure. */
  annotation_marks?: { text: string; x: number; y: number }[];
  /** Origin's real axis titles, decoded from the graph's title text objects
   *  (io/origin_project/figures.py). "" / absent = none decoded (the plot then
   *  falls back to the data-derived label). Applied by applyOriginFigure. */
  x_title?: string;
  y_title?: string;
  /** Secondary-Y axis title (double-Y graphs); decoded but not yet wired. */
  y2_title?: string;
  /** Per-curve legend labels (1-based curve order): either hand-edited
   *  literal text, or Origin's auto template (`%(n)`, optionally prefixed by
   *  a `\l(n)` swatch marker) — resolved to the bound curve's display name by
   *  `resolveLegendTemplate` before it reaches `seriesLabels`, in
   *  `figureChannelSelection` (curve-binding order, count-compatible prefix
   *  only — see its doc) and the cross-book overlay (`buildOverlayDataset`/
   *  `overlayCurveLabels`). */
  legend_labels?: string[];
  /** Origin's decoded major-tick increment for this axis
   *  (`io/origin_project/figures.py`/`figures_opju.py`, oracle-verified). On a
   *  LOG axis this is a LINEAR value step, not a log10/decade multiplier
   *  (verified against PNR.opj Graph50: y in [0.7139, 1.2732], y_step 0.1 ->
   *  ticks 0.8/0.9/1.0/1.1/1.2). null/absent = undecoded; `fixedLogAxisSplits`
   *  then falls back to a "nice number" linear step. */
  x_step?: number | null;
  y_step?: number | null;
  /** The Origin legend box's top-left corner at DATA coordinates (same
   *  position model as annotation_marks; log axes decoded in log10 space).
   *  null/absent = no legend or position not decoded (never guessed).
   *  applyOriginFigure maps it to the nearest legend corner preset. */
  legend_pos?: { x: number; y: number } | null;
  /** Decoded curve bindings, when the importer recovered any. */
  curves?: OriginCurve[];
  /** 1-based layer index within the graph window (multi-layer .opj windows
   *  emit one figure per layer; absent/1 = single-layer or unknown). */
  layer?: number;
  /** This layer's frame rect on the page, in Origin page units
   *  (`figure_geometry.opj_layer_frame`/`opju_layer_frame`). null/absent =
   *  undecoded (older/composite/embedded layer variants) — never guessed.
   *  Drives the spatial multi-panel apply (`lib/originPanels.ts`). */
  frame?: { left: number; top: number; right: number; bottom: number } | null;
  /** The graph page's (width, height) in the SAME page units as `frame`
   *  (`figure_geometry.opj_page_size`/`opju_page_size`). null/absent = not
   *  decoded/implausible — never guessed. Shared by every layer of one page. */
  page?: { width: number; height: number } | null;
  /** Filled region-shape objects (`Rect*` bands, decode-plan #41) at DATA
   *  coordinates, `.opj` only (`io/origin_project/opj_shapes.py`). `fill`
   *  is "#RRGGBB" or null (colour undecoded — such shades are skipped by
   *  `originRegionShades`, never guessed). */
  region_shades?: { x1: number; x2: number; y1: number; y2: number; fill?: string | null }[];
}

/** Response of POST /api/plot/series — uPlot-ready column data. */
export interface PlotSeriesResponse {
  /** Column-oriented: [xValues, series1Values, series2Values, ...] (null = NaN). */
  data: (number | null)[][];
  /** `axis` = 0 (primary/left Y) or 1 (secondary/right Y) for the dual-Y feature. */
  series: { label: string; unit: string; axis?: number }[];
  x: { label: string; unit: string; log: boolean };
  y: { log: boolean };
}

/** Response of POST /api/plot/map — a regular grid for the 2-D heatmap.
 *  `z_grid` is row-major `[ny][nx]` (null = NaN, i.e. outside the data hull);
 *  cell `z_grid[j][i]` sits at `(x_axis[i], y_axis[j])`. */
export interface MapResponse {
  x_axis: number[];
  y_axis: number[];
  z_grid: (number | null)[][];
  x: { label: string; unit: string };
  y: { label: string; unit: string };
  z: { label: string; unit: string; min: number | null; max: number | null };
}

/** One peak from POST /api/rsm/analyze. Centres/FWHM are `[omega, 2theta]` in
 *  angle space and `[Qx, Qz]` in reciprocal space (null when no Q-space). */
export interface RsmPeak {
  rank: number;
  centre_angle: [number, number];
  centre_Q: [number | null, number | null];
  fwhm_angle: [number, number];
  fwhm_Q: [number | null, number | null];
  amplitude: number;
  background: number;
  classification: string; // "substrate" | "film" | "unknown"
}

/** Response of POST /api/rsm/analyze. */
export interface RsmAnalysisResponse {
  peaks: RsmPeak[];
  n_peaks_found: number;
  intensity_unit: string;
  used_q_space: boolean;
}

/** Response of POST /api/rsm/strain (NaN fields serialize as null). */
export interface RsmStrainResponse {
  eps_parallel: number | null;
  eps_perp: number | null;
  a_sub_parallel: number;
  a_sub_perp: number;
  a_film_parallel: number;
  a_film_perp: number;
  relaxation: number | null;
}

/** A dataset held client-side: the parsed DataStruct + a stable id + name.
 *  `raw` is the pristine import; `data` is the currently displayed (corrected)
 *  view. `corrections` are the params that produced `data` from `raw`. */
/** A worksheet computed column: a display `name` and a formula `expr` over `x`
 *  and the channel letters (A, B, …). Stored on the dataset so it recomputes
 *  when the base data changes. The computed columns are always the LAST
 *  `formulas.length` columns of the dataset's `data`. */
export interface ComputedColumn {
  name: string;
  expr: string;
  unit?: string;
}

/** One column's non-destructive filter predicate (#53). `col` is -1 for x, 0..
 *  for a channel. `range` keeps min ≤ value ≤ max (either bound optional); `set`
 *  keeps values in `values` (nominal columns). See lib/datafilter. */
export interface ColumnFilter {
  col: number;
  kind: "range" | "set";
  min?: number;
  max?: number;
  values?: number[];
}

/** A dataset's local data filter — AND across its column predicates. */
export type DataFilter = ColumnFilter[];

export interface Dataset {
  id: string;
  name: string;
  data: DataStruct;
  raw?: DataStruct;
  corrections?: CorrectionParams;
  /** Reference-background subtraction folded into `corrections`: the picked
   *  background dataset's id + the interpolation method. Persisted so the
   *  Corrections card can re-populate and re-apply it reproducibly. */
  bgRef?: { datasetId: string; interp: string };
  /** The last fit run on this dataset (model name) — the recalc graph (#1)
   *  re-runs it when the data changes (auto mode) or marks it stale (manual).
   *  Set by the Curve Fit workshop; round-trips through .dwk v3. */
  fitSpec?: { model: string };
  /** Free-text user notes about this dataset (sample, conditions, caveats).
   *  Shown in the Inspector Notes card; round-trips through the .dwk workspace. */
  notes?: string;
  /** User tags for organizing + filtering the Library (e.g. "MvsH", "sample-A").
   *  Round-trips through the .dwk workspace. */
  tags?: string[];
  /** LEGACY read-only field — superseded by the folder tree (`folderId`).
   *  `useApp.loadWorkspace` promotes any un-foldered `group` into a
   *  root-level folder and clears it (`lib/foldertree.migrateGroupsToFolders`,
   *  project-organization plan item 6); nothing renders off this field
   *  anymore. Kept only so an old .dwk v1 doc (datasets carrying just a
   *  `group` string, no folder tree at all) still parses and migrates. */
  group?: string;
  /** Containing folder id (project-organization plan, Approach B). Absent = the
   *  dataset lives at the tree root. The folder tree itself is the store's
   *  `folders` slice; membership lives HERE (not as a folder child-list) so
   *  deleting a dataset can never dangle a ref. Pure organization — it never
   *  gates row-state (excludedRows/filter). Round-trips through .dwk v2. */
  folderId?: string;
  /** Sort key within the containing folder (see lib/order). Absent = fall back
   *  to insertion order. Round-trips through .dwk v2. */
  order?: number;
  /** Worksheet computed columns. They occupy the last `formulas.length` columns
   *  of `data` and recompute when the base data changes (cell edits, corrections).
   *  Round-trips through the .dwk workspace. */
  formulas?: ComputedColumn[];
  /** Per-channel column roles (label / ignore) — channel index → role. Excluded
   *  from the plot; semantic metadata about the columns, so they live ON the
   *  dataset (persist across dataset switches + round-trip .dwk), not in the
   *  transient view state. */
  channelRoles?: Record<number, ChannelRole>;
  /** Per-channel modeling-type OVERRIDES (channel index → type). Only user
   *  overrides are stored; absent channels use the auto-inference
   *  (lib/modeling.channelModelingType). Lives on the dataset like
   *  channelRoles: persists across switches + round-trips .dwk. */
  channelTypes?: Record<number, ModelingType>;
  /** Excluded original-row indices (JMP-style row state, #50). Excluded rows
   *  stay visible in the worksheet (greyed) but drop from analysis everywhere.
   *  Sorted, unique; managed only via lib/rowstate + the store's row actions,
   *  and round-trips through the .dwk workspace. */
  excludedRows?: number[];
  /** Local data filter (#53): non-destructive per-column predicates that narrow
   *  the analysis view (lib/rowstate.analysisData folds filter-failed rows in
   *  with excludedRows). Serializable; round-trips .dwk. */
  filter?: DataFilter;
  /** Lazy per-book import (ORIGIN_FILE_DECODE_PLAN #38): set for a non-primary
   *  Origin book whose full data hasn't been fetched yet — `data` above is
   *  the small downsampled preview (a real, if truncated, DataStruct: every
   *  consumer that only reads `.time`/`.values`/`.labels`/`.units`/`.metadata`
   *  keeps working, just on fewer rows, until the fetch lands). Cleared (and
   *  `data` replaced with the full DataStruct) by `useApp.ensureBookData`.
   *  Round-trips through autosave (so a reload restores the same not-yet-
   *  loaded state) but NEVER through an explicit "Save workspace (.dwk)…" —
   *  that command resolves every pending dataset first
   *  (`useApp.resolvePendingDatasets`) so an exported .dwk is self-contained. */
  pending?: BookSource;
  /** Where this dataset's data can be re-read from on demand (MAIN_PLAN #10,
   *  "re-import from source" — Origin's "Re-import Directly"): a real path the
   *  path-based `/api/parsers/import` route already validated. Set ONLY where
   *  a real path is actually knowable — mirrors `pending`'s `BookSource.kind
   *  === "path"` precedent. A browser file-picker/drag-drop upload never gets
   *  one (the File API exposes no path, and neither the pywebview desktop
   *  shell — no js_api bridge — nor the Tauri shell — `tauri-plugin-dialog`
   *  is Rust-only, never invoked from the frontend — surface one today); a
   *  sourceless dataset instead falls back to "Re-import from file…"
   *  (re-picks via the browser dialog, see `store/reimport.ts`). Round-trips
   *  through .dwk. */
  source?: { kind: "path"; path: string };
}

/** A folder in the Library's project tree (project-organization plan, Approach
 *  B). Folders are pure organization over the flat `datasets[]` array: a node
 *  carries only its identity, display name, parent link, and sort key. Datasets
 *  point INTO folders via `Dataset.folderId`; folders never list their children,
 *  so the two structures can't disagree. Round-trips through .dwk v2. */
export interface FolderNode {
  id: string;
  name: string;
  /** Parent folder id, or null for a top-level (root) folder. */
  parentId: string | null;
  /** Sort key among siblings sharing the same parent (see lib/order). */
  order: number;
}

/** A registered fit model's metadata (from GET /api/fitting/models). */
export interface FitModel {
  name: string;
  category: string;
  paramNames: string[];
  nParams: number;
  p0: number[];
  lb: (number | null)[];
  ub: (number | null)[];
}

/** Loose result dict from a calc route (fit result, stats, info, …). Keys are
 *  documented per endpoint; values may be scalars, arrays, or null (NaN/Inf). */
export type CalcResult = Record<string, unknown>;

/** A fit curve to overlay on the plot, tagged with the dataset it was fit to
 *  (so it only renders while that dataset is active). `y` aligns to the
 *  dataset's plotted x (null = gap). */
export interface FitOverlay {
  datasetId: string;
  y: (number | null)[];
}

/** Peak markers to overlay (points only). `y` is sparse — null except at the
 *  data points nearest each peak center. Tagged with the source dataset. */
export interface PeakOverlay {
  datasetId: string;
  y: (number | null)[];
}

/** An estimated baseline to overlay as a line, aligned 1:1 with the dataset's
 *  plotted x. Tagged with the source dataset (drops out when stale/mismatched). */
export interface BaselineOverlay {
  datasetId: string;
  y: (number | null)[];
}

/** One detected peak (from /api/peaks/find). */
export interface Peak {
  center: number;
  height: number;
  fwhm: number;
  prominence: number;
  localSNR: number;
  area: number | null;
  [key: string]: unknown;
}

/** One fitted peak (from /api/peaks/fit-multi, or mapped from /api/peaks/fit).
 *  `eta` is null for non-pseudo-Voigt models (NaN serialized at the wire). */
export interface FittedPeak {
  center: number;
  fwhm: number;
  height: number;
  bg: number;
  eta: number | null;
  area: number;
  status: string;
  model: string;
  [key: string]: unknown;
}

/** Result of a simultaneous multi-peak fit (/api/peaks/fit-multi). `R2`/`rmse`
 *  are NaN-serialized to null when synthesized from independent per-peak fits. */
export interface MultiFitResult {
  peaks: FittedPeak[];
  bgCoeffs: number[];
  R2: number | null;
  rmse: number | null;
  nPeaks: number;
  model: string;
}

/** Result of a single-peak window fit (/api/peaks/fit). */
export interface SinglePeakFit {
  success: boolean;
  reason: string;
  center: number;
  fwhm: number;
  height: number;
  bg: number;
  eta: number | null;
  area: number;
  params: number[];
  model: string;
  window: number[];
}

/** One material SLD preset (from GET /api/reflectivity/presets). `sldX` is the
 *  X-ray SLD (Å⁻²), `sldN` the neutron SLD, `sldImag` the X-ray imaginary part. */
export interface SldPreset {
  name: string;
  formula: string;
  sldX: number;
  sldN: number;
  sldImag: number;
  density: number;
  [key: string]: unknown;
}

/** A reference line drawn across the plot at a fixed X or Y value (mark Hc, Tc,
 *  zero, a critical edge…). Rendered by the uPlot refLinePlugin. */
export interface RefLine {
  id: string;
  axis: "x" | "y";
  value: number;
}

/** A filled rectangular region pinned at data coordinates (Origin `Rect*`
 *  region bands — film-stack shading on an SLD profile, decode-plan #41).
 *  Drawn translucently BEHIND the data by the uPlot regionShadePlugin
 *  (Origin's fill-transparency field is undecoded — the render alpha is a
 *  fixed presentation choice, see the plugin). `x1 < x2`, `y1 < y2`. */
export interface RegionShade {
  id: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  /** Fill colour "#RRGGBB", decoded from Origin's ocolor — shades whose
   *  colour didn't decode are never mapped into the store (no guessing). */
  fill: string;
  /** Which Y scale y1/y2 are expressed in: 0/undefined = primary, 1 =
   *  secondary (y2) — same convention as `Annotation.axis`. */
  axis?: 0 | 1;
}

/** Per-channel line style (solid/dashed/dotted) — maps to a uPlot dash array. */
export type LineStyle = "solid" | "dashed" | "dotted";
export type MarkerShape =
  | "circle"
  | "square"
  | "triangle"
  | "downtriangle"
  | "diamond"
  | "plus"
  | "cross"
  | "star";

/** A non-data column role (W5 DataWorkspace column roles). A channel with a role
 *  is excluded from the plot. `label` keeps it in the worksheet + its statistics
 *  (a descriptor column you tabulate but don't curve); `ignore` additionally
 *  drops it from the worksheet statistics (out of analysis). Absent = "data". */
export type ChannelRole = "label" | "ignore";

/** JMP-style column modeling type (ORIGIN_GAP_PLAN #48): what a column MEANS.
 *  `continuous` = a measurement axis; `ordinal` = ordered discrete levels;
 *  `nominal` = unordered categories. Auto-inferred per column
 *  (lib/modeling.ts); this type only appears on the dataset as a user
 *  OVERRIDE — absent = use the inference. */
export type ModelingType = "continuous" | "ordinal" | "nominal";

/** A text annotation pinned at a data coordinate (label a peak, a feature, a
 *  transition…). Drawn by the uPlot annotationPlugin as a dot + label.
 *  `y` is always in the coordinate space named by `axis`. */
export interface Annotation {
  id: string;
  x: number;
  y: number;
  text: string;
  /** Which Y scale `y` is expressed in: 0/undefined = primary, 1 = secondary
   *  (y2). Only ever set for the upper layer's marks in an Origin double-Y
   *  apply (`originFigureAnnotations`); manual annotations never set it, so
   *  they always plot on the primary axis. Ignored (falls back to the
   *  primary axis) when the plot has no y2 scale. */
  axis?: 0 | 1;
}

/** Axis tick number format. `auto` = uPlot's default; `fixed` = `toFixed(digits)`;
 *  `sci` = `toExponential(digits)`. `digits` is the decimal/mantissa count. */
export type TickMode = "auto" | "fixed" | "sci";

export interface AxisFormat {
  mode: TickMode;
  digits: number;
}

/** How an axis maps data values to pixel position (MAIN #12): `"linear"`
 *  (default) positions values proportionally; `"log"` positions by
 *  log10(value) (uPlot `distr: 3`); `"reciprocal"` positions by 1/value
 *  (uPlot custom `distr: 100` + `fwd`/`bwd` — see `lib/uplotOpts.ts`'s
 *  `reciprocalTransform`/`reciprocalAxisSplits`) while tick LABELS still read
 *  the original variable — the Arrhenius-plot convention (ln(rho) or log tau
 *  vs 1/T: the x DATA stays T, only its axis POSITIONING is 1/T-spaced).
 *  Replaces the old `xLog`/`yLog` booleans as the axis-scale source of truth
 *  (`lib/plotview.ts`'s `scaleFromLog` is the back-compat bridge for
 *  persisted `true`/`false` -> `"log"`/`"linear"`). */
export type AxisScale = "linear" | "log" | "reciprocal";

/** A per-channel styling override for the plot. Keyed in the store by the
 *  dataset *channel index* (stable across show/hide). Any field left unset
 *  falls back to the default (palette color by display position, 1.5 px,
 *  solid). `color` is either a token name (`"--series-3"`, re-themeable) or a
 *  literal hex (`"#ff8800"`, from the custom picker). */
export interface SeriesStyle {
  color?: string;
  width?: number;
  line?: LineStyle;
  marker?: boolean; // draw markers at each data point
  markerSize?: number; // marker diameter in px (default 5); only when marker
  markerShape?: MarkerShape; // marker glyph (default circle); only when marker
  /** Fill under/between curves (MAIN #13). `"none"`/undefined = no fill
   *  (default). `"under"` fills from the line down to a ZERO y baseline —
   *  uPlot's native `series.fill`/`fillTo` on screen, matplotlib
   *  `fill_between(x, y, 0)` on export. `{vs: <channel>}` fills the band
   *  BETWEEN this series and another plotted channel — uPlot's native
   *  `opts.bands` on screen, `fill_between(x, y, other)` on export. `vs` is
   *  always a dataset *channel index* (the same space `errKeys`/`colorBy`
   *  use); a channel not currently plotted silently drops the band (both
   *  uPlot bands and the export resolver can only fill between two DRAWN
   *  series). Fill colour is always derived from the series' own resolved
   *  stroke colour at a fixed translucency — never a separate stored colour. */
  fill?: "none" | "under" | { vs: number };
  /** Colour-mapped scatter (MAIN #14): colour each plotted point by a THIRD
   *  channel's value instead of a flat series colour. A dataset *channel
   *  index* (any channel, not required to be otherwise plotted) or
   *  null/undefined = off (the normal flat-colour line/marker rendering).
   *  When set, the line AND native points are hidden — a dedicated draw-hook
   *  plugin (`uplotOverlays.colorScatterPlugin`) paints coloured points
   *  keyed to this series' displayed x/y + the channel's values; the export
   *  path draws matplotlib `scatter(c=z, cmap=...)` + a colourbar instead of
   *  `ax.plot`. */
  colorBy?: number | null;
  /** Colormap for `colorBy` (`lib/colormap.ts`'s named maps — viridis/magma/
   *  gray). Only consulted when `colorBy` is set; default `"viridis"`. */
  colormap?: ColormapName;
}

/** One element row from the reference table. */
export interface ElementInfo {
  Z: number;
  symbol: string;
  name: string;
  [key: string]: unknown;
}

/** Correction-pipeline params (camelCase wire keys; all optional).
 *  Mirrors `routes/corrections.CorrectionParams` / MATLAB `correctionParams`. */
export interface CorrectionParams {
  xOff?: number;
  yOff?: number;
  bgSlope?: number;
  bgInt?: number;
  bgPoly?: number[];
  xTrimMin?: number;
  xTrimMax?: number;
  isNeutron?: boolean;
  isMag?: boolean;
  fieldUnit?: string;
  momentUnit?: string;
  sampleMass?: number;
  sampleVolume?: number;
  smoothEnabled?: boolean;
  smoothWindow?: number;
  smoothMethod?: string;
  normMethod?: string;
  derivativeMode?: string;
  /** GOTO #2 anchor-point baseline subtraction: user-picked (x, y) anchor
   *  pairs + the interpolation method (linear/pchip/spline). Present with
   *  >=2 anchors = subtracted in pipeline step 3 (beats bgPoly/slope). */
  bgAnchors?: [number, number][];
  bgAnchorMethod?: string;
  /** GOTO #7b XRR/NR beam-footprint correction: beam width + sample length
   *  (any one shared length unit — only w/L enters the geometry) and whether
   *  x is the detector angle 2θ (then θ = x/2). Both > 0 = enabled
   *  (pipeline step 2b; `dq` channels are skipped). */
  footprintW?: number;
  footprintL?: number;
  footprintTwoTheta?: boolean;
}

// ── Import wizard (ORIGIN_GAP_PLAN #40) ─────────────────────────────────────

/** Per-column role, mirroring the backend's `ImportSettings.roles` semantics
 *  (`io/import_preview.DATA_ROLES`): `x` becomes the axis, `y`/`error` become
 *  DataStruct channels, `label`/`ignore` are dropped (numeric-only contract). */
export type ImportColumnRole = "x" | "y" | "error" | "label" | "ignore";

/** How to read a delimited file — mirrors
 *  `quantized.io.import_preview.ImportSettings.to_dict()` exactly (also the
 *  persistable import-filter shape). */
export interface ImportSettingsWire {
  delimiter: string;
  header_line: number | null;
  units_line: number | null;
  data_start_line: number;
  column_names: string[] | null;
  roles: ImportColumnRole[] | null;
}

/** One resolved column descriptor from `preview_import`. */
export interface ImportPreviewColumn {
  index: number;
  name: string;
  unit: string;
  role: ImportColumnRole;
}

/** `/api/import/preview` response — the wizard's live preview payload. */
export interface ImportPreviewResponse {
  raw_lines: string[];
  n_lines: number;
  delimiter: string;
  header_line: number | null;
  units_line: number | null;
  data_start_line: number;
  columns: ImportPreviewColumn[];
  rows: (number | null)[][];
  n_data_rows: number;
  n_preview_rows: number;
}

/** A saved, named `ImportSettingsWire` bound to a filename glob
 *  (`io.import_filters.ImportFilter`). */
export interface ImportFilterWire {
  name: string;
  glob: string;
  settings: ImportSettingsWire;
  updated: string;
}

// ── Reductions (MAIN_PLAN #11) ──────────────────────────────────────────────
// Wire shapes of POST /api/reductions/{williamson-hall,fft-thickness,
// reflectivity-fft} (routes/reductions.py -> calc.reductions*). NaN-typed
// fields (undefined grain size, no superlattice detected) serialize as null —
// the routes return `dict[str, Any]`, which FastAPI runs through pydantic's
// JSON-mode encoder, converting NaN to null (verified empirically; same
// convention as RsmStrainResponse above).

/** Response of POST /api/reductions/williamson-hall. */
export interface WilliamsonHallResult {
  grain_size_nm: number | null; // null when the fit intercept <= 0 (undefined)
  microstrain: number;
  r2: number;
  plot_x: number[];
  plot_y: number[];
  fit_line: [number, number];
}

/** Response of POST /api/reductions/fft-thickness. */
export interface FftThicknessResult {
  thickness_nm: number;
  uncertainty_nm: number | null; // null when the FFT peak's FWHM can't be bracketed
  wavelength_a: number;
  two_theta_range: [number, number];
  fft_magnitude: number[];
  thickness_axis: number[];
  n_points: number;
}

/** The `superlattice` block of a reflectivity-FFT response — null fields when
 *  no bilayer periodicity was detected (`detected: false`, the common case). */
export interface SuperlatticeResult {
  detected: boolean;
  bilayer_period_nm: number | null;
  total_thickness_nm: number | null;
  n_repeats: number | null;
  sublayer_a_nm: number | null;
  sublayer_b_nm: number | null;
  suppressed_orders: number[];
}

/** Response of POST /api/reductions/reflectivity-fft. */
export interface ReflectivityFftResult {
  thicknesses_nm: number[];
  amplitudes: number[];
  harmonic_labels: string[];
  q_range: [number, number];
  preprocess: string;
  fft_magnitude: number[];
  thickness_axis: number[];
  is_neutron: boolean;
  wavelength_a?: number;
  superlattice: SuperlatticeResult;
}
