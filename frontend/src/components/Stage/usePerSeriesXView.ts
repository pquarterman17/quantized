// The plot's per-series-X step (Origin-gap audit 2, #2): every Y is drawn
// against its OWN X -- its nearest-preceding X column -- never against
// whichever column the plot's X happens to be. `lib/perSeriesX.ts` plans it
// and, when the shown curves span several X columns, builds the block-layout
// view the plot draws instead of the dataset. That module loads on demand:
// only a sheet with a designated X VALUE column needs it, and until it lands
// such a sheet draws nothing rather than drawing a Y on the wrong X.

import { useEffect, useMemo, useState } from "react";

import { effectiveDesignations } from "../../lib/columnmeta";
import { withLinkedLegends } from "../../lib/linkedLegends";
import { effectiveChannels } from "../../lib/plotdata";
import type { Dataset } from "../../lib/types";

type PerSeriesXModule = typeof import("../../lib/perSeriesX");
let loaded: PerSeriesXModule | null = null;
let loading: Promise<PerSeriesXModule> | null = null;

/** Load the planner once (shared by every plot surface). */
export function loadPerSeriesX(): Promise<PerSeriesXModule> {
  return (loading ??= import("../../lib/perSeriesX").then((m) => (loaded = m)));
}

interface SeriesXParams {
  active: Dataset | null | undefined;
  xKey: number | null;
  yKeys: number[] | null;
  seriesOrder: number[] | null;
  hiddenChannels: number[];
  selection?: { datasetId: string; rows: number[] } | null;
  seriesLabels?: Record<number, string>;
}

/** `p` with `active`/`xKey`/`selection` replaced by what the plot must draw
 *  (and a live graph's curve names under `seriesLabels` -- lib/linkedLegends.ts),
 *  plus the source rows per view block (0 = no view). */
export function usePerSeriesXView<P extends SeriesXParams>(params: P): { params: P; rowsPerBlock: number } {
  const labels = params.seriesLabels;
  const data0 = params.active?.data;
  const seriesLabels = useMemo(() => (labels ? withLinkedLegends(data0, labels) : labels), [data0, labels]);
  const p = useMemo(() => (seriesLabels === labels ? params : { ...params, seriesLabels }), [params, seriesLabels, labels]);
  const { active, xKey, yKeys, seriesOrder, hiddenChannels, selection } = p;
  const data = active?.data;
  const designations = active?.columnDesignations;
  const needs = useMemo(() => !!data && effectiveDesignations(data, designations).includes("X"), [data, designations]);
  const [, setLoadedTick] = useState(0);
  useEffect(() => {
    if (needs && !loaded) void loadPerSeriesX().then(() => setLoadedTick((t) => t + 1), () => undefined);
  }, [needs]);
  const mod = needs ? loaded : null;
  // The curves as the plot's own X decides them (so a changed X never turns
  // the old X column into a curve), and the shown ones the blocks follow.
  const plotted = useMemo(
    () => (mod && active ? effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder) : []),
    [mod, active, yKeys, xKey, seriesOrder],
  );
  const shown = useMemo(() => plotted.filter((c) => !hiddenChannels.includes(c)), [plotted, hiddenChannels]);
  const shownKey = shown.join(",");
  const plan = useMemo(
    () => (mod && active ? mod.perSeriesXPlan(active, xKey, shown) : null),
    // `shownKey` stands in for `shown` (a new array on every hidden toggle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mod, active, xKey, shownKey],
  );
  const view = plan?.view ?? null;
  const viewSelection = useMemo(
    () => (view && selection && selection.datasetId === view.dataset.id ? { ...selection, rows: mod!.viewRows(view, selection.rows) } : selection),
    [mod, view, selection],
  );
  const out = useMemo(() => {
    if (!needs) return p;
    if (!plan) return { ...p, active: null }; // the planner is still loading
    if (plan.xKey === xKey && !view) return p;
    return { ...p, active: view?.dataset ?? active, xKey: plan.xKey, yKeys: plotted, selection: viewSelection };
  }, [p, needs, plan, view, active, xKey, plotted, viewSelection]);
  return { params: out, rowsPerBlock: view?.rowsPerBlock ?? 0 };
}
