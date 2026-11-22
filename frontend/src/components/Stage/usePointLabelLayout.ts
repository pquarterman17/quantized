// The live plot's point labels (gap audit 8, LBL): `usePointLabelLayout` runs the
// shared layout (lib/pointLabelLayout.ts, the same one the export request runs)
// on the focused plot's view, and `useCanvasPointLabels` draws it over the uPlot
// instance (re-attached whenever PlotViewport rebuilds the instance). Off by
// default: with no label column set the layout is empty and nothing is drawn.
// `usePointLabelReadout` turns the cursor's data index into the dataset row
// number and its label value for the hover readout.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type uPlot from "uplot";

import { labelText, NO_LABELS, type LabelLayout } from "../../lib/pointLabelText";
import type { PlotPayload } from "../../lib/plotdata";
import { rowStateIdentity } from "../../lib/rowstate";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

type LayoutMod = typeof import("../../lib/figurePointLabels");
let layoutMod: LayoutMod | null = null;

/** The layout code (a lazy chunk: labels are off by default) once loaded; loads it the first time `needed`. */
function useLayoutModule(needed: boolean): LayoutMod | null {
  const [mod, setMod] = useState<LayoutMod | null>(layoutMod);
  useEffect(() => {
    if (!needed || mod) return;
    let live = true;
    void import("../../lib/figurePointLabels").then((m) => {
      layoutMod = m;
      if (live) setMod(m);
    }).catch(() => undefined); // offline: labels stay off, nothing else is affected
    return () => { live = false; };
  }, [needed, mod]);
  return mod;
}

/** The layout for the focused view of `active`; `selection` feeds "Selected rows". */
export function usePointLabelLayout(
  active: Dataset | null | undefined,
  selection: { datasetId: string; rows: number[] } | null | undefined,
  encoding: object | undefined,
): LabelLayout {
  const spec = useApp((s) => s.pointLabels);
  const xKey = useApp((s) => s.xKey), yKeys = useApp((s) => s.yKeys), y2Keys = useApp((s) => s.y2Keys);
  const seriesOrder = useApp((s) => s.seriesOrder), hiddenChannels = useApp((s) => s.hiddenChannels);
  const seriesStyles = useApp((s) => s.seriesStyles), xScale = useApp((s) => s.xScale), yScale = useApp((s) => s.yScale);
  const waterfall = useApp((s) => s.waterfall), waterfallDx = useApp((s) => s.waterfallDx);
  const exchangeXY = useApp((s) => s.exchangeXY), groupKey = useApp((s) => s.groupKey), facetKey = useApp((s) => s.facetKey);
  const lib = useLayoutModule(!!spec);
  const rows = selection && active && selection.datasetId === active.id ? selection.rows : null;
  const [excluded, filter] = rowStateIdentity(active); // + `active.data` below: what `droppedRows` reads
  const selectedKey = spec?.mode === "selected" && rows ? rows.join(",") : "";
  return useMemo(() => {
    if (!spec || !active || !lib) return NO_LABELS;
    const view = { xKey, yKeys, y2Keys, seriesOrder, hiddenChannels, seriesStyles, xScale, yScale, waterfall, waterfallDx, exchangeXY, facetKey };
    return lib.pointLabelLayoutFor({ dataset: active, view, spec, groupKey, encoding, selected: spec.mode === "selected" ? rows : null });
    // `active` is held by what the layout reads of it (its data, roles, exclusions, filter); `rows` by `selectedKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, spec, active?.id, active?.data, excluded, filter, active?.channelRoles, active?.columnDesignations,
    xKey, yKeys, y2Keys, seriesOrder, hiddenChannels, seriesStyles, xScale, yScale, waterfall, waterfallDx, exchangeXY, groupKey, facetKey, encoding, selectedKey]);
}

type DrawMod = typeof import("../../lib/pointLabelsDraw");

/** Draw `layout` on every build of the uPlot instance in `plotRef`. The drawing
 *  code loads on demand the first time labels are shown (off by default). */
export function useCanvasPointLabels(plotRef: RefObject<uPlot | null>, layout: LabelLayout, plotted: readonly number[]): void {
  const latest = useRef({ layout, plotted });
  latest.current = { layout, plotted };
  const attached = useRef<uPlot | null>(null);
  const mod = useRef<DrawMod | null>(null);
  const [, setLoaded] = useState(false);
  const shown = layout.points.length > 0 || !!layout.note || !!layout.refusal;
  const prev = useRef(false);
  useEffect(() => {
    if (!shown || mod.current) return;
    void import("../../lib/pointLabelsDraw").then((m) => {
      mod.current = m;
      plotRef.current?.redraw(false);
      setLoaded(true);
    });
  }, [shown, plotRef]);
  // A new layout asks the instance for a redraw (the draw hook reads `latest`).
  useEffect(() => {
    if (shown || prev.current) plotRef.current?.redraw(false);
    prev.current = shown;
  }, [layout, plotted, shown, plotRef]);
  // After every render: attach the draw hook to a freshly built instance.
  useEffect(() => {
    const u = plotRef.current;
    if (!shown || !u || attached.current === u) return; // off: touch nothing (labels are opt-in)
    attached.current = u;
    (u.hooks.draw ??= []).push((p: uPlot) => mod.current?.drawPointLabels(p, latest.current.layout, latest.current.plotted));
    if (mod.current) u.redraw(false);
  });
}

/** Row number (1-based, as the worksheet shows it) and label value under the cursor, or null. */
export function usePointLabelReadout(
  active: Dataset | null | undefined,
  payload: PlotPayload | null,
  idx: number | undefined,
): { row: number; label: string | null } | null {
  const spec = useApp((s) => s.pointLabels);
  if (!spec || !active || !payload || idx === undefined) return null;
  const n = active.data.values.length;
  const row = payload.rowIds ? payload.rowIds[idx] : payload.data[0].length === n ? idx : undefined;
  if (row === undefined || row < 0 || row >= n) return null;
  return { row: row + 1, label: labelText(active.data, spec.key, row) };
}
