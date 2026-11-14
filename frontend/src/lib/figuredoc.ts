// Figure documents (#12) + user graph templates (#15). A FigureDoc is a named
// figure in the workspace that re-opens, re-edits, and re-exports at any time:
// dataset ref (by id, never a copy — unless frozen), the full plot-state
// snapshot (channels/scales/labels), and the export config (#11's overrides
// object + preset/format/dpi). Live-linked docs render CURRENT data whenever
// opened (the builder reads live datasets, which the recalc graph keeps
// fresh); frozen docs carry their own data snapshot. A user graph template
// (#15) is the style half of a doc — preset + overrides + per-series styles —
// saved standalone and appliable to any figure. Pure, bar the
// lib/storageWarning.ts toast on a refused storage write.

import type { ErrorBinding } from "./errorRoles";
import type { FigureOverrides } from "./figureOverrides";
// The wire-style type AND its persistence sanitizer, both from the module that
// owns them. It used to be a type-only import from `lib/exportStyles` (which
// re-exports the type); taking it from the source lets the two `.dwk`
// sanitizers (`loadGraphTemplates` below, and `migrateConfig`, now in
// lib/figuredocSanitize.ts) call `sanitizeExportSeriesStyles` without pulling
// the export BUILDERS and the wire boundary into this module's runtime graph.
import { sanitizeExportSeriesStyles, type ExportSeriesStyle } from "./publicationStyles";
import { warnStorageRefused } from "./storageWarning";
import type { AxisScale, DataStruct } from "./types";

/** The builder configuration a FigureDoc restores (and a run re-exports). */
export interface FigureConfig {
  xKey: number | null;
  yKeys: number[] | null;
  /** Categorical column that splits every yKey into one series per group
   *  level (GUI_INTERACTION #12 Slice 5 -- the Graph Builder "group" zone's
   *  colour split, `lib/plotspec.ts`'s `buildXY`). Additive/optional: absent
   *  (undefined) on any doc saved before this field existed, and on every
   *  ordinary (non-grouped) doc -- `null` and `undefined` both mean "no
   *  group split". Only `plotSpecToFigureDoc` (the Graph Builder handoff)
   *  ever sets it; the plain Figure Builder screen has no live "group"
   *  concept of its own. */
  groupCol?: number | null;
  xScale: AxisScale;
  yScale: AxisScale;
  title: string;
  xLabel: string;
  yLabel: string;
  style: string;
  fmt: string;
  dpi: number;
  overrides: FigureOverrides | null;
  seriesStyles: (ExportSeriesStyle | null)[] | null;
  /** Canonical error-bar bindings (ORIGIN_GAP_PLAN #51 phase 3 — the Graph
   *  Builder's Y-error/X-error wells). Additive/optional: absent on every doc
   *  saved before this field existed and on every doc built outside the
   *  Graph Builder bridge; `figureDocumentFromLegacyFigureDoc` threads it
   *  into `createFigureDocument`'s `errors` input so Publication Preview
   *  opened from Graph Builder carries the SAME error bars the wells
   *  describe, independent of whatever `Dataset.errorRoles` currently holds
   *  (the wells may not have been committed to the dataset yet — see
   *  `plotSpecToFigureDoc`). Only `plotSpecToFigureDoc` ever sets it. */
  errors?: ErrorBinding[] | null;
}

export interface FigureDoc {
  id: string;
  name: string;
  /** Source dataset (by id). Nulled if that dataset is removed — the doc then
   *  only renders if frozen. */
  datasetId: string | null;
  config: FigureConfig;
  /** true = render current data on open (default); false = frozen. */
  live: boolean;
  /** The data as-of freezing (present iff !live). */
  dataSnapshot?: DataStruct;
}

/** The style half of a config — what a user graph template (#15) carries. */
export interface GraphTemplate {
  name: string;
  style: string;
  overrides: FigureOverrides | null;
  seriesStyles: (ExportSeriesStyle | null)[] | null;
  /** Where the template came from: absent = saved by the user in the Figure
   *  Builder; "origin" = imported from an Origin .otp/.otpu graph template
   *  (MAIN_PLAN #5 — lib/originTemplate). Extra fields survive the
   *  localStorage round-trip (isTemplate only checks name/style). */
  source?: string;
  /** The Stage-side style (B2 figures audit, `lib/graphFormat.ts`'s
   *  `GraphFormat`): axis scales/formats, chrome and per-POSITION series
   *  styles, captured from a plot window or a canonical Publication preview
   *  draft. Absent on a template saved before it existed; the Stage then
   *  restyles from `seriesStyles` alone (`seriesStyleFromExport`).
   *
   *  Typed `unknown` and NOT validated on load: every consumer is a lazy
   *  chunk that runs `sanitizeGraphFormat` itself, so this always-loaded
   *  module never pulls the format code into the eager bundle. */
  format?: unknown;
}

// ── .dwk sanitizers ─────────────────────────────────────────────────────────
// `sanitizeFigureDocs` and the two helpers only it calls moved verbatim to
// lib/figuredocSanitize.ts (bundle diet slice 27, plans/BUNDLE_HEADROOM.md):
// only the lazy `.dwk` read (lib/workspace.ts) calls them, and this module is
// eager (the Saved figures list, File ▸ graph templates).

/** A FigureDoc can render only from its exact live source or its frozen
 * snapshot. Requiring the current id set makes every caller fail closed for
 * stale live references instead of falling through to the active dataset. */
export function docRenderable(doc: FigureDoc, datasetIds: ReadonlySet<string>): boolean {
  return doc.live
    ? doc.datasetId !== null && datasetIds.has(doc.datasetId)
    : doc.dataSnapshot !== undefined;
}

// ── User graph templates (#15) — localStorage, like peak recipes ───────────
const KEY = "qz.graphTemplates";

/** Exported (P3.5) so `lib/nameKeyedRecipes.ts` can validate an imported file
 *  with the SAME load-time tolerance `loadGraphTemplates` uses, rather than a
 *  second hand-rolled shape check that could drift from this one. The
 *  IMPORT path layers stricter checks on top (name non-empty, `overrides`/
 *  `seriesStyles` typed when present) — deliberately NOT added here, so a
 *  pre-#15 stored record missing those fields still PASSES this check. What
 *  `loadGraphTemplates` does with it afterwards is not unchanged: see its own
 *  comment on the `seriesStyles` normalization. */
export function isGraphTemplate(v: unknown): v is GraphTemplate {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && typeof o.style === "string";
}

export function loadGraphTemplates(): GraphTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // The SECOND persistence path for a pinned style array (BUG-016 round 4,
    // kept in round 5). A template saved before `colorDerived` existed — or
    // imported from an Origin file by a build that predates it — would
    // otherwise reach `docSeriesStyles` (`useGraphTemplates.applyStyleTemplate`)
    // and then the export wire carrying a MALFORMED flag that the wire would
    // read as the document's word. The sanitizer drops such a flag; it infers
    // nothing, so this call does not read the theme (round 5) and two loads of
    // the same store under two palettes are identical.
    //
    // `seriesStyles` is the only field touched, and it is NORMALIZED, not left
    // alone: a record that never had the field comes back with an explicit
    // `seriesStyles: null` (the "this template carries none" sentinel
    // `applyStyleTemplate` already coerced to with `?? null`), and
    // `saveGraphTemplate`/`deleteGraphTemplate` then persist that shape for
    // every template in the store. The tolerant `isGraphTemplate` check above
    // is itself unchanged.
    return parsed.filter(isGraphTemplate).map((t) => ({
      ...t,
      seriesStyles: sanitizeExportSeriesStyles(t.seriesStyles),
    }));
  } catch {
    return [];
  }
}

/** Save (upsert by name) and return the new list. */
export function saveGraphTemplate(t: GraphTemplate): GraphTemplate[] {
  const list = loadGraphTemplates().filter((x) => x.name !== t.name);
  list.push(t);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    warnStorageRefused("graph template"); // stays session-local
  }
  return list;
}

export function deleteGraphTemplate(name: string): GraphTemplate[] {
  const list = loadGraphTemplates().filter((x) => x.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    warnStorageRefused("graph template");
  }
  return list;
}
