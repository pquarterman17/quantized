// Pure builders for the LEGACY (non-canonical) Publication Preview mode --
// the path that mirrors the live on-screen plot, or re-opens a saved
// `FigureDoc`, rather than editing a canonical `FigureDocument` draft.
//
// Extracted from useFigureBuilder.ts, which sits on a hard module-size pin:
// every canonical slice since F2.3b has had to fund its wiring by moving a
// cohesive block out first (canonicalReadiness.ts did it for F2.3c). These two
// builders are the natural next block -- both are total functions of the
// legacy field set, neither touches React or the store, and the request shape
// they produce is the one thing in that file worth testing without mounting a
// hook.
//
// The two share `LegacyFigureState` deliberately: `saveAsFigure` persists the
// same picks the preview renders, so a field that drifts between them is a bug
// (a saved doc that reopens looking different from the preview it was saved
// from). One input type makes that structural instead of a review question.

import type { FigureSpec } from "../../../lib/api/figures";
import { resolveSecondaryAxis, secondaryAxisWire, type SecondaryAxisSpec } from "../../../lib/axisspec";
import { buildExportStyles, toWireSeriesStyles, type ExportSeriesStyle } from "../../../lib/exportStyles";
import type { FigureDoc } from "../../../lib/figuredoc";
import { compactOverrides, type FigureOverrides } from "../../../lib/figureOverrides";
import { traceSeriesStyles } from "../../../lib/exportDefaultTrace";
import { ghosterFor } from "../../../lib/excludedRowsExport";
import type { ExcludedRowsGhoster } from "../../../lib/figureSpec";
import { droppedRows, pruneToLiveDataset } from "../../../lib/rowstate";
import {
  axisFmtParam,
  type AxisFormat,
  type AxisScale,
  type DataStruct,
  type Dataset,
  type DefaultTrace,
  type SeriesStyle,
} from "../../../lib/types";
import type { ExcludedDisplay } from "../../../store/useApp";

export interface LegacyFigureState {
  /** A re-opened doc's frozen snapshot, else the active dataset's data. Null
   *  makes both builders no-op -- there is nothing to render or save. */
  data: DataStruct | null;
  /** Already resolved against the re-opened doc's picks by the caller (a doc
   *  pick wins over the live plot's; see useFigureBuilder's `eff*`). */
  xKey: number | null;
  yKeys: number[] | null;
  xScale: AxisScale;
  yScale: AxisScale;
  xFmt: AxisFormat;
  yFmt: AxisFormat;
  style: string;
  overrides: FigureOverrides;
  title: string;
  xLabel: string;
  yLabel: string;
  /** Live per-channel styles, used only when `docSeriesStyles` is absent. */
  seriesStyles: Record<number, SeriesStyle>;
  /** `undefined` = no saved doc, so mirror the live styles; `null` = a doc
   *  that explicitly carries none; an array = the doc's own, in ITS display
   *  order. The three-way distinction is why this is not just `| null`. */
  docSeriesStyles: (ExportSeriesStyle | null)[] | null | undefined;
  docGroupCol: number | null;
  /** The live plot's secondary (right) Y axis, mirrored like its xFmt/yFmt;
   *  null for a re-opened doc, since a `FigureDoc` config carries no y2. The
   *  preview-only field: "Save as figure" cannot persist it (known gap, see
   *  FIGURE_AUTHORING_WORKFLOW_PLAN F2.1g). */
  y2: SecondaryAxisSpec | null;
  /** The live dataset `data` mirrors, whose excluded and filter-dropped rows
   *  the canvas never draws as data (F4.2c (a)); null/absent for a frozen
   *  doc's snapshot. The REQUEST drops those rows (or greys them, see
   *  `buildLegacyFigureSpec`); "Save as figure" still keeps every row. */
  liveDataset?: Dataset | null;
  /** The Preferences trace the canvas draws unstyled series in; the REQUEST
   *  draws them the same way (`exportDefaultTrace`), the saved doc does not. */
  defaultTrace?: DefaultTrace;
}

/** The channels a spec plots when `yKeys` is the "all channels" null sentinel. */
function plottedChannels(state: LegacyFigureState, data: DataStruct): number[] {
  return state.yKeys ?? data.labels.map((_, index) => index);
}

/** The DOCUMENT form of this figure's per-series styles: a saved doc's own
 *  array wins over the live per-channel ones, and an explicit null stays null.
 *  Shared by both builders so a saved doc cannot reopen looking different from
 *  the preview it was saved from — the reason they share this function at all.
 *
 *  BUG-016: a `docGroupCol` request has the backend expand every entry onto
 *  one series per group LEVEL, so a palette-derived colour (which belongs to a
 *  level's display position, not to the channel) must not reach the wire.
 *  `buildExportStyles`' `grouped` doc carries that rule for the DERIVED array.
 *
 *  ROUND 3: the rule is applied at the WIRE, in `buildLegacyFigureSpec`, not
 *  here. Round 2 stripped inside this helper, so "Save as figure" wrote the
 *  stripped array back into `config.seriesStyles` and permanently destroyed a
 *  colour field the document had (review F6) — for no gain, since stripping on
 *  the wire alone satisfies the same "preview, export and saved doc cannot
 *  disagree" argument: both builders start from THIS array, and the one that
 *  builds a request is the only one that has a request to obey. What the doc
 *  now persists is the array WITH its `colorDerived` provenance, which is what
 *  lets the reopened doc reproduce the same wire under any palette. */
function exportStyles(
  state: LegacyFigureState,
  data: DataStruct,
): (ExportSeriesStyle | null)[] | null {
  if (state.docSeriesStyles !== undefined) return state.docSeriesStyles;
  return buildExportStyles(
    plottedChannels(state, data), state.seriesStyles, null, false, state.docGroupCol !== null,
  );
}

/** The request shared by the debounced PNG preview and the export at the
 *  chosen format/DPI. Null with no data -- the caller renders nothing.
 *  F4.2c (a): the live dataset's dropped rows are pruned, as the canvas hides
 *  them, and `greyExcluded` (the app mode for the preview, the user's answer
 *  for the export) draws them as grey companions instead. */
export function buildLegacyFigureSpec(
  state: LegacyFigureState,
  greyExcluded?: ExcludedRowsGhoster,
): FigureSpec | null {
  if (!state.data) return null;
  // The document form -> the wire form: the grouped colour rule for a PINNED
  // array, and the provenance flag off, on every request (BUG-016 round 3).
  const docStyles = exportStyles(state, state.data);
  const wireStyles = docStyles === null ? null : toWireSeriesStyles(docStyles, state.docGroupCol !== null);
  // The default trace reads each series' RAW line: a saved doc's own entry, else the live style.
  const plotted = plottedChannels(state, state.data);
  const raw = state.docSeriesStyles === undefined
    ? state.seriesStyles
    : Object.fromEntries(plotted.map((ch, i) => [ch, docStyles?.[i] ?? undefined]));
  const styles = traceSeriesStyles(wireStyles, plotted, state.defaultTrace, raw);
  // F2.1g's legacy y2 placebo: the hook enabled y2-limit controls off the live
  // y2Keys while this request never declared `y2_keys`, so the server dropped
  // every `y2_lim` they wrote. The hook now reads `hasY2` off THIS field, so a
  // control is live exactly when the wire has an axis for it. The split and
  // its inherit rules are lib/axisspec.ts's, shared with the Stage export; a
  // grouped request cannot carry y2 at all (the backend 422s the pair).
  const y2Axis = state.y2 === null || state.docGroupCol !== null
    ? null
    : resolveSecondaryAxis(plotted, state.y2, { scale: state.yScale, fmt: state.yFmt });
  const spec: FigureSpec = {
    dataset: pruneToLiveDataset(state.data, state.liveDataset),
    x_key: state.xKey ?? undefined,
    y_keys: state.yKeys ?? undefined,
    x_log: state.xScale === "log",
    y_log: state.yScale === "log",
    x_scale: state.xScale,
    y_scale: state.yScale,
    x_fmt: axisFmtParam(state.xFmt),
    y_fmt: axisFmtParam(state.yFmt),
    style: state.style,
    overrides: compactOverrides(state.overrides),
    title: state.title.trim(),
    x_label: state.xLabel.trim() || undefined,
    y_label: state.yLabel.trim() || undefined,
    series_styles: styles ?? undefined,
    group_col: state.docGroupCol ?? undefined,
    ...secondaryAxisWire(y2Axis),
  };
  if (!state.liveDataset) return spec;
  return stableWireDataset(
    greyExcluded ? greyExcluded(spec, state.data, droppedRows(state.liveDataset)) : spec,
    state.liveDataset,
    state.data,
    `${greyExcluded ? "grey" : "omit"}|${String(spec.x_key)}|${String(spec.y_keys)}`,
  );
}

/** The last wire dataset built per live dataset. A pruned or greyed dataset is
 *  a NEW object on every build, and the preview's dataset-handle cache
 *  (`lib/api/datasetCache.ts`) is keyed on that object, so without this every
 *  title keystroke would re-upload the whole dataset. Reused only while the
 *  same live dataset, data and channel picks produced it. */
const lastWire = new WeakMap<Dataset, { data: DataStruct; key: string; dataset: DataStruct }>();

function stableWireDataset(spec: FigureSpec, live: Dataset, data: DataStruct, key: string): FigureSpec {
  if (spec.dataset === data) return spec; // nothing dropped: already the stable object
  const hit = lastWire.get(live);
  if (hit && hit.data === data && hit.key === key) return { ...spec, dataset: hit.dataset };
  lastWire.set(live, { data, key, dataset: spec.dataset });
  return spec;
}

/** The preview's request: excluded rows drawn as the canvas draws them
 *  (the app-wide "Excluded rows" mode). */
export function buildLegacyPreviewSpec(state: LegacyFigureState, mode: ExcludedDisplay): FigureSpec | null {
  return buildLegacyFigureSpec(state, ghosterFor(mode));
}

/** The named `FigureDoc` "Save as figure" persists (#12). A live doc
 *  references its dataset by id; a frozen one carries the data snapshot, so
 *  it still renders after that dataset is removed. Null with no data. */
export function buildLegacyFigureDoc(
  state: LegacyFigureState,
  identity: { id: string; name: string; datasetId: string | null; live: boolean },
  output: { fmt: string; dpi: number },
): FigureDoc | null {
  if (!state.data) return null;
  return {
    id: identity.id,
    name: identity.name,
    datasetId: identity.datasetId,
    live: identity.live,
    ...(identity.live ? {} : { dataSnapshot: state.data }),
    config: {
      xKey: state.xKey,
      yKeys: state.yKeys,
      groupCol: state.docGroupCol,
      xScale: state.xScale,
      yScale: state.yScale,
      title: state.title,
      xLabel: state.xLabel,
      yLabel: state.yLabel,
      style: state.style,
      fmt: output.fmt,
      dpi: output.dpi,
      overrides: compactOverrides(state.overrides),
      seriesStyles: exportStyles(state, state.data),
    },
  };
}
