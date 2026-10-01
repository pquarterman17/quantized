// Plot recipe SPATIAL composition (F4.4's spatial half / audit P1.3
// "maps/panels"): capture a live spatial multi-panel arrangement
// (`lib/composition.ts`'s `SpatialComposition`, built by an Origin figure
// apply) BY NAME -- dataset name + column labels, never an index -- and
// rebuild it later against another dataset, plus the durable 2-D map view
// decisions (`lib/mapView.ts`) that ride along with it.
//
// Follows `plotRecipeMatch.ts`'s idioms one level down: every channel is
// re-keyed by LABEL with the same exact-then-folded tiers a signature entry
// gets, a fold-only duplicate is never guessed at, and a binding that cannot
// be resolved is NAMED (`unmatched` string + a structured `issue`) so the
// apply dialog can offer a rebind rather than silently drop it. Two things
// are softer than a signature entry, by design: (a) a panel's `dataset` is a
// NAME lookup among the datasets the caller lists (the recipe's own dataset
// is `null` and always resolves to the apply target), and (b) a per-panel
// `RecipePanelBinding` from the user overrides either lookup outright.
//
// Lazy: reached only from `plotRecipe.ts` (capture) and `plotRecipeMatch.ts`
// (resolve), both already off the eager chunk.

import { spatialPanelsOf, type Composition } from "./composition";
import type { MapViewState } from "./mapView";
import { DEFAULT_MAP_VIEW } from "./mapView";
import type { SpatialPanel } from "./multipanel";
import type { PageSetup } from "./pagesetup";
import type { PanelFit } from "./panelFit";
import type { PanelLayout } from "./panelWindowModel";
import type { RecipeMapView, RecipePanel, RecipePanels, RecipePanelWindow } from "./plotRecipeSchema";
import type { PlotView } from "./plotview";
import { normalizeLabel } from "./quickPlotTemplates";
import type { Dataset } from "./types";

/** A user's explicit answer to a missing panel binding (the apply dialog's
 *  rebind): the dataset this panel should read, and/or a saved column label
 *  -> current channel index for it. Keyed by panel index in the recipe. */
export interface RecipePanelBinding {
  datasetId?: string;
  channels?: Readonly<Record<string, number>>;
}

/** One binding that did not resolve, structured for the dialog's rebind
 *  controls. `panel` is the 0-based index into `RecipePanels.panels`. */
export type RecipePanelIssue =
  | { panel: number; kind: "dataset"; name: string }
  | { panel: number; kind: "channel"; datasetId: string; role: "x" | "y" | "y2"; label: string };

/** The rebuilt composition, ready for the store: real `SpatialPanel`s plus
 *  the two spatial-only `PlotView` fields. */
export interface ResolvedRecipePanels {
  panels: SpatialPanel[];
  panelFit: PanelFit;
  pageSetup: PageSetup | null;
}

/** A composite panel window to open (Q6): live dataset ids + layout, the
 *  `PlotWindow.panel` shape `createPanelWindow` takes. */
export interface ResolvedPanelWindow {
  datasetIds: string[];
  layout: PanelLayout;
}

export interface ResolvePanelsOptions {
  /** Every dataset a named panel may bind to. Defaults to the target alone,
   *  so a recipe resolved without a list still rebuilds its own panels. */
  datasets?: readonly Dataset[];
  panelBindings?: Readonly<Record<number, RecipePanelBinding>>;
}

export interface PanelsResolution {
  panels: ResolvedRecipePanels | null;
  unmatched: string[];
  issues: RecipePanelIssue[];
}

const ROLE_LABEL = { x: "X axis", y: "Y series", y2: "Y2 series" } as const;

const copyRange = (r: readonly [number, number]): [number, number] => [r[0], r[1]];

/** Capture `composition`'s spatial panels by name. Null for any other
 *  composition kind, or when no panel's dataset is in `datasets` (a panel
 *  whose dataset is not listed is dropped -- there is no name to save). */
export function capturePanels(
  composition: Composition | null,
  sourceDatasetId: string,
  datasets: readonly Dataset[],
  view: Pick<PlotView, "panelFit" | "pageSetup">,
): RecipePanels | null {
  const live = spatialPanelsOf(composition);
  if (!live) return null;
  const panels: RecipePanel[] = [];
  for (const p of live) {
    const ds = datasets.find((d) => d.id === p.datasetId);
    if (!ds) continue;
    const labels = ds.data.labels;
    const labelList = (chs: readonly number[]): string[] => chs.flatMap((ch) => (labels[ch] !== undefined ? [labels[ch]] : []));
    const byLabel = <T>(rec: Readonly<Record<number, T>> | undefined): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [k, v] of Object.entries(rec ?? {})) {
        const label = labels[Number(k)];
        if (label !== undefined) out[label] = structuredClone(v);
      }
      return out;
    };
    const errKeys: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.errKeys ?? {})) {
      const value = labels[Number(k)];
      const err = labels[v];
      if (value !== undefined && err !== undefined) errKeys[value] = err;
    }
    panels.push({
      dataset: p.datasetId === sourceDatasetId ? null : ds.name,
      x: p.xKey === null ? null : (labels[p.xKey] ?? null),
      y: labelList(p.yKeys),
      y2: labelList(p.y2Keys ?? []),
      xLim: copyRange(p.xLim),
      yLim: copyRange(p.yLim),
      y2Lim: p.y2Lim ? copyRange(p.y2Lim) : null,
      xStep: p.xStep ?? null,
      yStep: p.yStep ?? null,
      y2Step: p.y2Step ?? null,
      xLog: p.xLog,
      yLog: p.yLog,
      y2Log: p.y2Log ?? false,
      xAxisLabel: p.xAxisLabel,
      yAxisLabel: p.yAxisLabel,
      y2AxisLabel: p.y2AxisLabel,
      legendTitle: p.legendTitle,
      seriesStyles: byLabel(p.seriesStyles),
      seriesLabels: byLabel(p.seriesLabels),
      hiddenChannels: labelList(p.hiddenChannels ?? []),
      errKeys,
      annotations: structuredClone(p.annotations ?? []),
      regionShades: structuredClone(p.regionShades ?? []),
      row: p.row,
      col: p.col,
      frameRect: p.frameRect ? { ...p.frameRect } : undefined,
      layoutAspect: p.layoutAspect,
      pageRect: p.pageRect ? { ...p.pageRect } : undefined,
      pageAspect: p.pageAspect,
    });
  }
  if (panels.length === 0) return null;
  return { panels, panelFit: view.panelFit, pageSetup: view.pageSetup ? structuredClone(view.pageSetup) : null };
}

/** The source dataset's map view, recorded only when one of the three
 *  reusable decisions differs from the default. Slices and annotations are
 *  data-anchored and deliberately not captured. */
export function captureMapView(view: MapViewState | undefined): RecipeMapView | null {
  if (!view) return null;
  const untouched = view.colormap === DEFAULT_MAP_VIEW.colormap && !view.logZ && view.colorLimits === null;
  if (untouched) return null;
  const lim = view.colorLimits;
  return { colormap: view.colormap, logZ: view.logZ, colorLimits: lim ? [lim[0], lim[1]] : null };
}

/** `plotRecipeMatch.ts`'s `findChannel` tiers minus aliases (a panel channel
 *  has none): an exact unique match wins, then a folded unique match; a tier
 *  with two candidates is ambiguous and resolves nothing. */
function matchLabel(labels: readonly string[], label: string): number | null {
  const folded = normalizeLabel(label);
  for (const predicate of [(l: string) => l === label, (l: string) => normalizeLabel(l) === folded]) {
    const hits: number[] = [];
    labels.forEach((l, i) => {
      if (predicate(l)) hits.push(i);
    });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}

/** Panel `i`'s dataset: the user's explicit rebind first, then `null` -> the
 *  apply target, then a UNIQUE name match in the pool. A miss is named in
 *  `unmatched` and as a dataset `issue` (the apply dialog's rebind picker). */
function bindDataset(
  saved: string | null,
  i: number,
  target: Dataset,
  opts: ResolvePanelsOptions,
  unmatched: string[],
  issues: RecipePanelIssue[],
): Dataset | undefined {
  const pool = opts.datasets ?? [target];
  const bound = opts.panelBindings?.[i]?.datasetId;
  let ds: Dataset | undefined;
  if (bound !== undefined) {
    ds = pool.find((d) => d.id === bound) ?? (target.id === bound ? target : undefined);
  } else if (saved === null) {
    ds = target;
  } else {
    const named = pool.filter((d) => d.name === saved);
    ds = named.length === 1 ? named[0] : undefined;
  }
  if (!ds) {
    const name = saved ?? target.name;
    unmatched.push(`Panel ${i + 1} dataset ("${name}")`);
    issues.push({ panel: i, kind: "dataset", name });
  }
  return ds;
}

/** A composite panel window, captured by NAME (Q6): the source dataset's
 *  cell is null, every other cell its dataset's name. Undefined when the
 *  source is not one of the window's cells. */
export function capturePanelWindow(
  panel: { datasetIds: readonly string[]; layout: PanelLayout } | undefined,
  sourceDatasetId: string,
  datasets: readonly Dataset[],
): RecipePanelWindow | undefined {
  if (!panel?.datasetIds.includes(sourceDatasetId)) return undefined;
  const names = panel.datasetIds.flatMap((id) => {
    if (id === sourceDatasetId) return [null];
    const ds = datasets.find((d) => d.id === id);
    return ds ? [ds.name] : [];
  });
  return { datasets: names, layout: panel.layout };
}

/** Rebind a captured composite window's cells (the same tiers a spatial
 *  panel's dataset gets, keyed by cell index). A missing cell is dropped and
 *  named; null when no cell resolved. */
export function resolvePanelWindow(
  recipe: RecipePanelWindow,
  target: Dataset,
  opts: ResolvePanelsOptions = {},
): { window: ResolvedPanelWindow | null; unmatched: string[]; issues: RecipePanelIssue[] } {
  const unmatched: string[] = [];
  const issues: RecipePanelIssue[] = [];
  const datasetIds = recipe.datasets.flatMap((name, i) => {
    const ds = bindDataset(name, i, target, opts, unmatched, issues);
    return ds ? [ds.id] : [];
  });
  return { window: datasetIds.length > 0 ? { datasetIds, layout: recipe.layout } : null, unmatched, issues };
}

/** Rebuild `recipe`'s panels against `target` (the recipe's own dataset) and
 *  the named siblings in `opts.datasets`. Pure. A panel whose dataset, X, or
 *  every Y is missing is dropped and named; a style/label/hidden/error entry
 *  keyed to a missing label is silently omitted (nothing sane to key it to,
 *  the same rule `resolveRecipe` applies to visual overrides). */
export function resolvePanels(recipe: RecipePanels, target: Dataset, opts: ResolvePanelsOptions = {}): PanelsResolution {
  const unmatched: string[] = [];
  const issues: RecipePanelIssue[] = [];
  const panels: SpatialPanel[] = [];
  recipe.panels.forEach((p, i) => {
    const binding = opts.panelBindings?.[i];
    const dataset = bindDataset(p.dataset, i, target, opts, unmatched, issues);
    if (!dataset) return;
    const labels = dataset.data.labels;
    const find = (label: string): number | null => {
      const bound = binding?.channels?.[label];
      if (bound !== undefined && labels[bound] !== undefined) return bound;
      return matchLabel(labels, label);
    };
    const need = (label: string, role: "x" | "y" | "y2"): number | null => {
      const ch = find(label);
      if (ch === null) {
        unmatched.push(`Panel ${i + 1} ${ROLE_LABEL[role]} ("${label}")`);
        issues.push({ panel: i, kind: "channel", datasetId: dataset.id, role, label });
      }
      return ch;
    };
    const xKey = p.x === null ? null : need(p.x, "x");
    const yKeys = p.y.flatMap((l) => {
      const ch = need(l, "y");
      return ch === null ? [] : [ch];
    });
    const y2Keys = p.y2.flatMap((l) => {
      const ch = need(l, "y2");
      return ch === null ? [] : [ch];
    });
    if ((p.x !== null && xKey === null) || yKeys.length === 0) return;
    const byChannel = <T>(rec: Readonly<Record<string, T>>): Record<number, T> => {
      const out: Record<number, T> = {};
      for (const [label, v] of Object.entries(rec)) {
        const ch = find(label);
        if (ch !== null) out[ch] = structuredClone(v);
      }
      return out;
    };
    const errKeys: Record<number, number> = {};
    for (const [value, err] of Object.entries(p.errKeys)) {
      const v = find(value);
      const e = find(err);
      if (v !== null && e !== null) errKeys[v] = e;
    }
    panels.push({
      datasetId: dataset.id,
      xKey,
      yKeys,
      xLim: copyRange(p.xLim),
      yLim: copyRange(p.yLim),
      xLog: p.xLog,
      yLog: p.yLog,
      xStep: p.xStep,
      yStep: p.yStep,
      xAxisLabel: p.xAxisLabel,
      yAxisLabel: p.yAxisLabel,
      legendTitle: p.legendTitle,
      seriesStyles: byChannel(p.seriesStyles),
      seriesLabels: byChannel(p.seriesLabels),
      hiddenChannels: p.hiddenChannels.flatMap((l) => {
        const ch = find(l);
        return ch === null ? [] : [ch];
      }),
      errKeys,
      annotations: structuredClone(p.annotations),
      regionShades: structuredClone(p.regionShades),
      ...(y2Keys.length > 0
        ? { y2Keys, y2Lim: p.y2Lim ? copyRange(p.y2Lim) : null, y2Log: p.y2Log, y2Step: p.y2Step, y2AxisLabel: p.y2AxisLabel }
        : {}),
      row: p.row,
      col: p.col,
      frameRect: p.frameRect ? { ...p.frameRect } : undefined,
      layoutAspect: p.layoutAspect,
      pageRect: p.pageRect ? { ...p.pageRect } : undefined,
      pageAspect: p.pageAspect,
    });
  });
  return {
    panels:
      panels.length > 0
        ? { panels, panelFit: recipe.panelFit, pageSetup: recipe.pageSetup ? structuredClone(recipe.pageSetup) : null }
        : null,
    unmatched,
    issues,
  };
}
