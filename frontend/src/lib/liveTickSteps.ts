// The major tick increment the focused canvas actually DREW on each axis,
// offered to an export as a hint (`x_step_hint` / `y_step_hint` /
// `y2_step_hint`). 0.34.0 copied it into `x_step` / `y_step` (figures
// integration: the screen read 2, 4, ... where the export's AutoLocator chose
// 2.5, 5, ...), which crowded short export axes; the backend now takes the
// hint only when it fits the laid-out axes (`calc.tick_hint`).
//
// Module-scope seam like `lib/waterfallOffset.publishLiveWaterfallSpan`: the
// focused stage's canvas publishes (`lib/liveTicksPlugin.ts`), the export
// reads at command time, keyed by dataset so a refocus race never carries
// one plot's ticks onto another. Not store state -- publishing must cause no
// re-render. Turning them into hints is export-only and lives in the lazy
// export path (`lib/liveTickStepsSpec.ts`).

export interface LiveTickSteps {
  datasetId: string | null;
  x?: number;
  y?: number;
  y2?: number;
}

let live: LiveTickSteps | null = null;

/** Publish (or clear, with null) the increments the focused canvas drew. */
export function publishLiveTickSteps(v: LiveTickSteps | null): void {
  live = v;
}

/** The focused canvas' increments for `datasetId`, or null. */
export function readLiveTickSteps(datasetId: string): LiveTickSteps | null {
  return live && live.datasetId === datasetId ? live : null;
}

/** The smallest positive gap between drawn ticks (a broken axis' splits
 *  skip the elided stretch, so the first gap alone is not the increment). */
export function drawnIncrement(splits: readonly (number | null | undefined)[] | null | undefined): number | undefined {
  let best = Infinity;
  const v = (splits ?? []).filter((s): s is number => s != null && Number.isFinite(s));
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    if (d > 0 && d < best) best = d;
  }
  return Number.isFinite(best) ? Number(best.toPrecision(12)) : undefined;
}
