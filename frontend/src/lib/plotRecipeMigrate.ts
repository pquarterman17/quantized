// Plot recipe schema migration (F4.2 / audit P1.3: "version migration beyond
// the v1 parse-gate"). Before this, `plotRecipeIO.ts` accepted exactly one
// `schemaVersion` and dropped (tolerant path) or refused (strict path)
// everything else, so the first real schema change would have silently lost
// every recipe a user had saved. Now every read boundary routes through
// `migrateRecipeObject` first:
//
//   * an OLDER recipe is walked forward one version at a time by the step
//     table below (each step is a pure object -> object function that adds or
//     reshapes exactly what its version introduced) and then validated as a
//     current-version recipe by the same per-field sanitizers as always;
//   * a NEWER recipe (a file or project from a later build) is refused with
//     its own named error -- never guessed at, never down-converted;
//   * anything that is not an integer version at all is "unsupported", the
//     wording `parseRecipe` has always used.
//
// ADDING v4: bump `PLOT_RECIPE_SCHEMA_VERSION` (plotRecipeSchema.ts), add a
// `3: v3ToV4` step here, and add a frozen v3 literal to the migration test.
// Steps never read a field later than their own version, so a v1 recipe
// passes through every step in order.
//
// The v2/v3 fields' sanitizers live here, beside the steps that introduced
// them, so plotRecipeIO.ts (near its line ceiling) only wires them in.

import { COLORMAP_NAMES } from "./mapView";
import type { ColormapName } from "./colormap";
import type { NormalizedFrameRect } from "./originPanels";
import { sanitizePageSetup } from "./pagesetup";
import { PANEL_FITS, type PanelFit } from "./panelFit";
import { PANEL_LAYOUTS, type PanelLayout } from "./panelWindowModel";
import {
  PLOT_RECIPE_SCHEMA_VERSION,
  type RecipeMapView,
  type RecipeOutlierPolicy,
  type RecipePanel,
  type RecipePanels,
  type RecipePanelWindow,
  type RecipePreview,
  type RecipeTransformRef,
} from "./plotRecipeSchema";
import { sanitizeAnnotations } from "./plotview";
import { sanitizeRegionShades } from "./plotviewSanitize";
import { isString, keyedRecord } from "./sanitizeRecord";
import type { SeriesStyle } from "./types";

type Raw = Record<string, unknown>;

/** v1 -> v2: the preview, outlier policy and transformation reference did not
 *  exist, so they are recorded as "not captured" (null) -- never invented. */
function v1ToV2(o: Raw): Raw {
  return { ...o, schemaVersion: 2, preview: null, outlierPolicy: null, transform: null };
}

/** Every migration step in order: `from` is the version it upgrades. The
 *  loop below walks this fixed list and applies the steps at or above the
 *  file's version, so a version read from a file is only ever COMPARED,
 *  never used to look anything up (CodeQL: unvalidated dynamic method call). */
/** v2 -> v3: the spatial panels and map view were never captured in a
 *  rebuildable form, so both read as "not recorded" -- never invented from
 *  `visual.compositionKind`. */
function v2ToV3(o: Raw): Raw {
  return { ...o, schemaVersion: 3, panels: null, map: null };
}

const STEPS: readonly { from: number; run: (o: Raw) => Raw }[] = [
  { from: 1, run: v1ToV2 },
  { from: 2, run: v2ToV3 },
];

export type RecipeMigration = { ok: Raw } | { error: string };

/** Walk `o` forward to `PLOT_RECIPE_SCHEMA_VERSION`. Pure: never mutates `o`.
 *  The result still needs the ordinary per-field validation; this only
 *  guarantees the SHAPE is the current version's. */
export function migrateRecipeObject(o: Raw): RecipeMigration {
  const v = o.schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    return { error: `unsupported plot recipe schema version: ${String(v)}` };
  }
  if (v > PLOT_RECIPE_SCHEMA_VERSION) {
    return {
      error: `plot recipe schema version ${v} is newer than this app supports (v${PLOT_RECIPE_SCHEMA_VERSION}); update Quantized to open it`,
    };
  }
  let cur = o;
  let at = v;
  for (const step of STEPS) {
    if (step.from < at) continue;
    if (step.from !== at) break; // a gap in the chain
    cur = step.run(cur);
    at += 1;
  }
  if (at !== PLOT_RECIPE_SCHEMA_VERSION) return { error: `unsupported plot recipe schema version: ${v}` };
  return { ok: cur };
}

// ── v2 field sanitizers ─────────────────────────────────────────────────

export const PREVIEW_MAX_SERIES = 4;
export const PREVIEW_MAX_POINTS = 48;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Numbers only, clamped to [0, 1], capped at 4 series x 48 points; a point
 *  that is not two finite numbers is dropped, a series left empty is dropped,
 *  and a preview left with no series is null. */
export function sanitizePreview(v: unknown): RecipePreview | null {
  if (typeof v !== "object" || v === null) return null;
  const raw = (v as Raw).series;
  if (!Array.isArray(raw)) return null;
  const series: [number, number][][] = [];
  for (const s of raw) {
    if (!Array.isArray(s)) continue;
    const pts: [number, number][] = [];
    for (const p of s) {
      if (!Array.isArray(p) || p.length !== 2) continue;
      const [x, y] = p as unknown[];
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push([clamp01(x), clamp01(y)]);
      if (pts.length === PREVIEW_MAX_POINTS) break;
    }
    if (pts.length > 0) series.push(pts);
    if (series.length === PREVIEW_MAX_SERIES) break;
  }
  return series.length > 0 ? { series } : null;
}

export function sanitizeOutlierPolicy(v: unknown): RecipeOutlierPolicy | null {
  const d = typeof v === "object" && v !== null ? (v as Raw).excludedDisplay : undefined;
  return d === "hide" || d === "grey" ? { excludedDisplay: d } : null;
}

export function sanitizeTransformRef(v: unknown): RecipeTransformRef | null {
  if (typeof v !== "object" || v === null) return null;
  const { name, revision } = v as Raw;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return null;
  return { name, revision };
}

// ── v3 field sanitizers ─────────────────────────────────────────────────

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRange = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]);
const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString) : []);
const rect = (v: unknown): NormalizedFrameRect | undefined => {
  if (typeof v !== "object" || v === null) return undefined;
  const { left, top, width, height } = v as Raw;
  return finite(left) && finite(top) && finite(width) && finite(height) ? { left, top, width, height } : undefined;
};

/** One panel: a bad dataset binding, X, Y list, limit, or grid cell drops
 *  the panel (nothing sane to draw); every other field degrades alone. */
function sanitizePanel(v: unknown): RecipePanel | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Raw;
  if (o.dataset !== null && typeof o.dataset !== "string") return null;
  if (o.x !== null && typeof o.x !== "string") return null;
  const y = stringList(o.y);
  if (y.length === 0 || !isRange(o.xLim) || !isRange(o.yLim)) return null;
  if (!Number.isInteger(o.row) || !Number.isInteger(o.col) || (o.row as number) < 0 || (o.col as number) < 0) return null;
  const step = (s: unknown): number | null => (finite(s) ? s : null);
  const str = (s: unknown): string | undefined => (typeof s === "string" ? s : undefined);
  return {
    dataset: o.dataset,
    x: o.x,
    y,
    y2: stringList(o.y2),
    xLim: o.xLim,
    yLim: o.yLim,
    y2Lim: isRange(o.y2Lim) ? o.y2Lim : null,
    xStep: step(o.xStep),
    yStep: step(o.yStep),
    y2Step: step(o.y2Step),
    xLog: o.xLog === true,
    yLog: o.yLog === true,
    y2Log: o.y2Log === true,
    xAxisLabel: o.xAxisLabel === null ? null : str(o.xAxisLabel),
    yAxisLabel: str(o.yAxisLabel),
    y2AxisLabel: str(o.y2AxisLabel),
    legendTitle: str(o.legendTitle),
    seriesStyles: keyedRecord<SeriesStyle>(o.seriesStyles, (x): x is SeriesStyle => typeof x === "object" && x !== null),
    seriesLabels: keyedRecord<string>(o.seriesLabels, isString),
    hiddenChannels: stringList(o.hiddenChannels),
    errKeys: keyedRecord<string>(o.errKeys, isString),
    annotations: sanitizeAnnotations(o.annotations),
    regionShades: sanitizeRegionShades(o.regionShades),
    row: o.row as number,
    col: o.col as number,
    frameRect: rect(o.frameRect),
    layoutAspect: finite(o.layoutAspect) && o.layoutAspect > 0 ? o.layoutAspect : undefined,
    pageRect: rect(o.pageRect),
    pageAspect: finite(o.pageAspect) && o.pageAspect > 0 ? o.pageAspect : undefined,
  };
}

/** Null (not recorded) unless at least one panel survives. */
export function sanitizePanels(v: unknown): RecipePanels | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Raw;
  if (!Array.isArray(o.panels)) return null;
  const panels = o.panels.map(sanitizePanel).filter((p): p is RecipePanel => p !== null);
  if (panels.length === 0) return null;
  return {
    panels,
    panelFit: (PANEL_FITS as readonly string[]).includes(o.panelFit as string) ? (o.panelFit as PanelFit) : "frames",
    pageSetup: sanitizePageSetup(o.pageSetup),
  };
}

/** A composite panel window (v3, additive): every cell a dataset name or the
 *  one null apply-target slot, plus a known layout; anything else is not
 *  recorded (undefined), never a guessed window. */
export function sanitizePanelWindow(v: unknown): RecipePanelWindow | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const { datasets, layout } = v as Raw;
  if (!Array.isArray(datasets) || !(PANEL_LAYOUTS as readonly unknown[]).includes(layout)) return undefined;
  if (!datasets.every((d) => d === null || (typeof d === "string" && d !== ""))) return undefined;
  if (datasets.filter((d) => d === null).length !== 1) return undefined;
  return { datasets: [...(datasets as (string | null)[])], layout: layout as PanelLayout };
}

/** An unknown colormap or a non-boolean scale is not a view (both are the
 *  decision being recorded); limits that are not an ascending pair read as
 *  auto. */
export function sanitizeMapView(v: unknown): RecipeMapView | null {
  if (typeof v !== "object" || v === null) return null;
  const { colormap, logZ, colorLimits } = v as Raw;
  if (typeof colormap !== "string" || !COLORMAP_NAMES.includes(colormap) || typeof logZ !== "boolean") return null;
  return {
    colormap: colormap as ColormapName,
    logZ,
    colorLimits: isRange(colorLimits) && colorLimits[1] > colorLimits[0] ? [colorLimits[0], colorLimits[1]] : null,
  };
}
