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
import { buildExportStyles, type ExportSeriesStyle } from "../../../lib/exportStyles";
import type { FigureDoc } from "../../../lib/figuredoc";
import { compactOverrides, type FigureOverrides } from "../../../lib/figureOverrides";
import { axisFmtParam, type AxisFormat, type AxisScale, type DataStruct, type SeriesStyle } from "../../../lib/types";

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
}

/** The channels a spec plots when `yKeys` is the "all channels" null sentinel. */
function plottedChannels(state: LegacyFigureState, data: DataStruct): number[] {
  return state.yKeys ?? data.labels.map((_, index) => index);
}

/** Resolve the export styles for either builder: a saved doc's own styles win
 *  over the live per-channel ones, and an explicit null stays null. */
function exportStyles(
  state: LegacyFigureState,
  data: DataStruct,
): (ExportSeriesStyle | null)[] | null {
  return state.docSeriesStyles !== undefined
    ? state.docSeriesStyles
    : buildExportStyles(plottedChannels(state, data), state.seriesStyles);
}

/** The request shared by the debounced PNG preview and the export at the
 *  chosen format/DPI. Null with no data -- the caller renders nothing. */
export function buildLegacyFigureSpec(state: LegacyFigureState): FigureSpec | null {
  if (!state.data) return null;
  const styles = exportStyles(state, state.data);
  return {
    dataset: state.data,
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
  };
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
