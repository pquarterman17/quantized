// Quick Plot's seed for a DECLARED per-series-X worksheet: an Origin book
// designating further "X" columns (X,Y,X,Y,X,Y), the one layout
// `lib/quickPlot.ts`'s module doc lets Quick Plot re-pair. Origin's own rule
// binds each Y to its nearest-preceding X (`opj_curves.py`, mirrored by the
// Quick Figure Builder's `initialQuickFigureMapping`), so the figure plots
// the same segment-concatenated overlay the builder creates
// (`quickFigureSeriesX.ts`) instead of drawing every loop against the first
// X. The overlay itself comes from the builder's own `quickFigureOverlay`,
// so the one-click figure and the configured one cannot disagree.
//
// LAZY on purpose (the eager-bundle ratchet, frontend/scripts/check-bundle-
// size.mjs): store/quickPlotRun.ts imports this module only when
// `hasDesignatedSeriesX` says the gesture needs it -- the same shape as its
// on-demand error review (`lib/quickPlotErrorReview.ts`). Nothing eager may
// import it statically.

import { effectiveDesignations } from "./columnmeta";
import { hasFiniteValue, ownXSeries } from "./ownXSeries";
import { errKeysFromBindings, type ErrorBinding } from "./errorRoles";
import { legacyErrorBindings } from "./figureDocument";
import type { PlotView } from "./plotview";
import { quickPlotFigureSeed } from "./quickPlot";
import { quickFigureOverlay, type QuickFigureOverlay } from "./quickFigureSeriesX";
import type { TechniqueViewMemoryMap } from "./techniqueViewMemory";
import type { Dataset } from "./types";

/** `quickPlotFigureSeed`'s shape, re-keyed to the overlay's columns, plus
 *  the overlay the figure must bind to (store/quickPlotAction.ts turns it
 *  into the Library dataset). */
export interface QuickPlotSeriesXSeed {
  name: string;
  view: PlotView;
  errors: ErrorBinding[];
  overlay: QuickFigureOverlay;
}

/** The per-series-X seed for `dataset`, or null when every plotted Y shares
 *  `.time` after all (then the plain seed applies, unchanged). Same
 *  arguments as `quickPlotFigureSeed`, which it starts from: `withhold`'s
 *  held pairings stay hidden, and neither a hidden column nor an error
 *  column is ever a Y. */
export function quickPlotSeriesXSeed(
  dataset: Dataset,
  memory: TechniqueViewMemoryMap = {},
  withhold: readonly ErrorBinding[] = [],
): QuickPlotSeriesXSeed | null {
  const seed = quickPlotFigureSeed(dataset, memory, withhold);
  const own = ownXSeries(effectiveDesignations(dataset.data, dataset.columnDesignations));
  // The one-X default plot holds a Y on a secondary X back (store/
  // windowDefaults' own-X rule); HERE each Y gets its own X, so those are
  // exactly the series to draw -- only the other held columns stay out.
  const excluded = new Set([
    ...seed.view.hiddenChannels.filter((c) => !Object.hasOwn(own, c)),
    ...seed.errors.map((b) => b.channel),
  ]);
  // A never-filled column is no curve (no empty legend entry).
  const yKeys = (seed.view.yKeys ?? dataset.data.labels.map((_, c) => c)).filter(
    (c) => !excluded.has(c) && hasFiniteValue(dataset.data.values, c),
  );
  // Origin's nearest-preceding-X rule over the effective designations (the
  // book's own `column_designations` plus the user's "Set As" overrides).
  const xKeyByY: Record<number, number> = {};
  for (const y of yKeys) if (Object.hasOwn(own, y)) xKeyByY[y] = own[y];
  const overlay = quickFigureOverlay(dataset.data, { xKey: null, xKeyByY, yKeys, errorBindings: seed.errors, ignoredKeys: [] });
  if (!overlay) return null;
  // The figure binds to the overlay, so every channel-keyed field is re-keyed
  // to ITS columns (the technique's scales and the like carry over
  // unchanged); the overlay's own mapping already lists the error bindings.
  const bindings = overlay.mapping.errorBindings;
  const errKeys = errKeysFromBindings(bindings);
  const view: PlotView = {
    ...seed.view,
    xKey: null,
    yKeys: [...overlay.mapping.yKeys],
    groupKey: null,
    facetKey: null,
    y2Keys: null,
    seriesStyles: {},
    seriesLabels: {},
    seriesOrder: null,
    hiddenChannels: [],
    errKeys,
  };
  const rich = bindings.filter((b) => b.axis !== "y" || b.side !== "both");
  return { name: seed.name, view, errors: [...rich, ...legacyErrorBindings(errKeys)], overlay };
}
