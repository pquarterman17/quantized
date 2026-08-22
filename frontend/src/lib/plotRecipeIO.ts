// Plot recipe persistence/parsing boundary -- split out of `plotRecipe.ts`
// (which owns the schema + pure capture) to keep both files well under the
// 500-line god-module ceiling. `parseRecipe` is the strict, throwing entry
// point for an explicit import/paste (the `lib/template.ts` `parseTemplate`
// precedent: throws "unsupported ... version" on a schema mismatch, throws a
// clear message on any other structural defect). `sanitizeRecipes` is the
// tolerant, NEVER-throws entry point for the untrusted `.dwk`/workspace-load
// boundary (the `lib/quickPlotTemplates.ts` `sanitizeQuickPlotTemplates`
// "drop-malformed-never-throw" shape) -- each list entry validated
// independently, a bad one dropped without disturbing its siblings. Both
// route through the same per-field validators, so "strict throw" and
// "tolerant drop" never silently diverge on what counts as well-formed.

import {
  legendXYOrNull,
  sanitizeAnnotations,
  sanitizeRegionShades,
  sanitizeShapes,
  LEGEND_POS,
  isAxisScale,
  type LegendPos,
} from "./plotview";
import { PLOT_MARKS, type PlotMark } from "./plotspec";
import type { SignatureErrorRole } from "./quickPlotTemplates";
import { isValidTechnique } from "./techniqueDefaults";
import type { AxisFormat, SeriesStyle, TickMode } from "./types";
import {
  PLOT_RECIPE_SCHEMA_VERSION,
  type PlotRecipe,
  type RecipeAxisBreaks,
  type RecipeAxisRange,
  type RecipeChannelRole,
  type RecipeErrorBinding,
  type RecipeMapping,
  type RecipeSignatureEntry,
  type RecipeVisual,
} from "./plotRecipe";
import type { CompositionKind } from "./composition";
import type { ErrorSide } from "./errorRoles";

const ROLES: readonly RecipeChannelRole[] = ["x", "y", "y2", "group", "facet", "error"];
const ERROR_ROLES: readonly SignatureErrorRole[] = [
  "value", "error-x", "error-x+", "error-x-", "error-y", "error-y+", "error-y-",
];
const COMPOSITION_KINDS: readonly CompositionKind[] = ["spatial", "facet", "break"];
const TICK_MODES: readonly TickMode[] = ["auto", "fixed", "sci", "eng", "date", "time", "datetime"];

function isRole(v: unknown): v is RecipeChannelRole {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

function isErrorRole(v: unknown): v is SignatureErrorRole {
  return typeof v === "string" && (ERROR_ROLES as readonly string[]).includes(v);
}

function isErrorSide(v: unknown): v is ErrorSide {
  return v === "both" || v === "+" || v === "-";
}

function isRange(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) && v.length === 2 &&
    typeof v[0] === "number" && typeof v[1] === "number" &&
    Number.isFinite(v[0]) && Number.isFinite(v[1])
  );
}

function isAxisFormat(v: unknown): v is AxisFormat {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.mode === "string" && (TICK_MODES as readonly string[]).includes(o.mode) &&
    typeof o.digits === "number" && Number.isFinite(o.digits)
  );
}

// ── signature + mapping ─────────────────────────────────────────────────

/** Validate the full signature list; returns null (the whole recipe is
 *  dropped/rejected) if the list itself or ANY entry is malformed -- the
 *  signature is the matching substrate every mapping/visual field points
 *  into, so a corrupt entry would leave dangling ids everywhere downstream
 *  rather than degrading gracefully to a default (mirrors
 *  `quickPlotTemplates.ts`'s `sanitizeSignature` returning null on the same
 *  class of defect). */
function sanitizeSignatureEntries(v: unknown): RecipeSignatureEntry[] | null {
  if (!Array.isArray(v)) return null;
  const out: RecipeSignatureEntry[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) return null;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) return null;
    if (!isRole(o.role)) return null;
    if (typeof o.label !== "string" || typeof o.unit !== "string") return null;
    if (!isErrorRole(o.errorRole)) return null;
    const aliases = Array.isArray(o.aliases) ? o.aliases.filter((a): a is string => typeof a === "string") : [];
    out.push({ id: o.id, role: o.role, label: o.label, unit: o.unit, errorRole: o.errorRole, aliases });
  }
  return out;
}

function sanitizeErrorBindingsList(v: unknown): RecipeErrorBinding[] {
  if (!Array.isArray(v)) return [];
  const out: RecipeErrorBinding[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.channel !== "string" || !o.channel) continue;
    if (typeof o.target !== "string" && o.target !== null) continue;
    if (o.axis !== "x" && o.axis !== "y") continue;
    if (!isErrorSide(o.side)) continue;
    out.push({ channel: o.channel, target: o.target, axis: o.axis, side: o.side });
  }
  return out;
}

/** A nullable string field (`xId`/`groupId`/`facetId`): present as a string,
 *  present as `null`, or absent -- anything else (wrong type) is malformed.
 *  `undefined` distinguishes "malformed" from the valid `null` case for the
 *  caller. */
function nullableStringField(v: unknown): string | null | undefined {
  if (typeof v === "string") return v;
  if (v === null) return null;
  return undefined;
}

/** True when `signature` carries two entries with the same `id` (finding 2a:
 *  a duplicate id makes every mapping/visual reference to it ambiguous --
 *  which entry did "y0" mean? -- so the whole recipe is structurally
 *  corrupt, not a per-field default case). */
function hasDuplicateSignatureIds(signature: readonly RecipeSignatureEntry[]): boolean {
  const seen = new Set<string>();
  for (const e of signature) {
    if (seen.has(e.id)) return true;
    seen.add(e.id);
  }
  return false;
}

/** True when `mapping` names a signature id that ISN'T in `ids` (finding
 *  2a): a dangling mapping reference. Left unchecked, `resolveRecipe` would
 *  silently null/drop that binding without ever adding it to `unmatched`,
 *  bypassing the "non-empty unmatched -> preview+confirm" contract with a
 *  silent partial apply -- so this is a load-bearing structural check, not
 *  a nicety. Scoped to MAPPING ids only (not `visual`'s seriesStyles/
 *  seriesOrder/hiddenChannels keys) -- a dangling VISUAL id already degrades
 *  safely by design (see `ResolvedRecipeVisual`'s doc in plotRecipeMatch.ts:
 *  "there is nothing sane to key a style override to"), so it carries none
 *  of the silent-channel-binding risk this check exists to close. */
function mappingReferencesUnknownId(mapping: RecipeMapping, ids: ReadonlySet<string>): boolean {
  const refs: (string | null)[] = [
    mapping.xId,
    mapping.groupId,
    mapping.facetId,
    ...mapping.yIds,
    ...mapping.y2Ids,
    ...mapping.errors.flatMap((e) => [e.channel, e.target]),
  ];
  return refs.some((id) => id !== null && !ids.has(id));
}

function sanitizeMapping(v: unknown): RecipeMapping | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const xId = nullableStringField(o.xId);
  const groupId = nullableStringField(o.groupId);
  const facetId = nullableStringField(o.facetId);
  if (xId === undefined || groupId === undefined || facetId === undefined) return null;
  if (!Array.isArray(o.yIds) || !o.yIds.every((x) => typeof x === "string")) return null;
  if (!Array.isArray(o.y2Ids) || !o.y2Ids.every((x) => typeof x === "string")) return null;
  return {
    xId,
    yIds: o.yIds as string[],
    y2Ids: o.y2Ids as string[],
    groupId,
    facetId,
    errors: sanitizeErrorBindingsList(o.errors),
  };
}

// ── visual (per-field fallback -- never rejects the whole recipe) ────────

function defaultRecipeVisual(): RecipeVisual {
  return {
    mark: "line",
    xScale: "linear",
    yScale: "linear",
    y2Scale: null,
    xRange: { mode: "auto" },
    yRange: { mode: "auto" },
    y2Range: { mode: "auto" },
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    y2Fmt: null,
    axisBreaks: { x: [], y: [], y2: [] },
    showLegend: true,
    legendPos: "ne",
    legendXY: null,
    legendTitle: null,
    legendStatic: false,
    stackMode: false,
    waterfall: 0,
    plotTemplate: "screen",
    seriesStyles: {},
    seriesLabels: {},
    seriesOrder: null,
    hiddenChannels: [],
    decorations: { annotations: [], shapes: [], regionShades: [] },
    compositionKind: null,
  };
}

function sanitizeRange(v: unknown, fb: RecipeAxisRange): RecipeAxisRange {
  if (typeof v !== "object" || v === null) return fb;
  const o = v as Record<string, unknown>;
  if (o.mode === "auto") return { mode: "auto" };
  if (o.mode === "fixed" && isRange(o.lim)) {
    return typeof o.step === "number" && Number.isFinite(o.step)
      ? { mode: "fixed", lim: o.lim, step: o.step }
      : { mode: "fixed", lim: o.lim };
  }
  return fb;
}

function sanitizeAxisBreaks(v: unknown): RecipeAxisBreaks {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const ranges = (c: unknown): [number, number][] => (Array.isArray(c) ? c.filter(isRange) : []);
  return { x: ranges(o.x), y: ranges(o.y), y2: ranges(o.y2) };
}

/** Structural passthrough for `seriesStyles` (like `lib/plotview.ts`'s
 *  `sanitizePlotView` does for the same field) -- no deep per-field
 *  `SeriesStyle` validation, just an object-shape + string-key check.
 *  `seriesLabels` gets the stricter string-value check since its values are
 *  meant for display verbatim. */
function strKeyedRecord<T>(v: unknown, guard: (x: unknown) => x is T): Record<string, T> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, T> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (guard(val)) out[k] = val;
  return out;
}

function isSeriesStyle(v: unknown): v is SeriesStyle {
  return typeof v === "object" && v !== null;
}

function sanitizeVisual(v: unknown): RecipeVisual {
  const fb = defaultRecipeVisual();
  if (typeof v !== "object" || v === null) return fb;
  const o = v as Record<string, unknown>;
  const decor = typeof o.decorations === "object" && o.decorations !== null
    ? (o.decorations as Record<string, unknown>)
    : {};
  return {
    mark: (PLOT_MARKS as readonly string[]).includes(o.mark as string) ? (o.mark as PlotMark) : fb.mark,
    xScale: isAxisScale(o.xScale) ? o.xScale : fb.xScale,
    yScale: isAxisScale(o.yScale) ? o.yScale : fb.yScale,
    y2Scale: isAxisScale(o.y2Scale) ? o.y2Scale : null,
    xRange: sanitizeRange(o.xRange, fb.xRange),
    yRange: sanitizeRange(o.yRange, fb.yRange),
    y2Range: sanitizeRange(o.y2Range, fb.y2Range),
    xFmt: isAxisFormat(o.xFmt) ? o.xFmt : fb.xFmt,
    yFmt: isAxisFormat(o.yFmt) ? o.yFmt : fb.yFmt,
    y2Fmt: isAxisFormat(o.y2Fmt) ? o.y2Fmt : null,
    axisBreaks: sanitizeAxisBreaks(o.axisBreaks),
    showLegend: typeof o.showLegend === "boolean" ? o.showLegend : fb.showLegend,
    legendPos: (LEGEND_POS as readonly string[]).includes(o.legendPos as string) ? (o.legendPos as LegendPos) : fb.legendPos,
    legendXY: legendXYOrNull(o.legendXY),
    legendTitle: typeof o.legendTitle === "string" ? o.legendTitle : null,
    legendStatic: typeof o.legendStatic === "boolean" ? o.legendStatic : fb.legendStatic,
    stackMode: typeof o.stackMode === "boolean" ? o.stackMode : fb.stackMode,
    waterfall: typeof o.waterfall === "number" && Number.isFinite(o.waterfall) ? o.waterfall : fb.waterfall,
    plotTemplate: typeof o.plotTemplate === "string" ? o.plotTemplate : fb.plotTemplate,
    seriesStyles: strKeyedRecord<SeriesStyle>(o.seriesStyles, isSeriesStyle),
    seriesLabels: strKeyedRecord<string>(o.seriesLabels, (x): x is string => typeof x === "string"),
    seriesOrder: Array.isArray(o.seriesOrder)
      ? o.seriesOrder.filter((x): x is string => typeof x === "string")
      : null,
    hiddenChannels: Array.isArray(o.hiddenChannels)
      ? o.hiddenChannels.filter((x): x is string => typeof x === "string")
      : [],
    decorations: {
      annotations: sanitizeAnnotations(decor.annotations),
      shapes: sanitizeShapes(decor.shapes),
      regionShades: sanitizeRegionShades(decor.regionShades),
    },
    compositionKind: (COMPOSITION_KINDS as readonly string[]).includes(o.compositionKind as string)
      ? (o.compositionKind as CompositionKind)
      : null,
  };
}

// ── top-level entry ──────────────────────────────────────────────────────

/** Validate one recipe object -- drop-malformed-never-throws for identity/
 *  signature/mapping (those default to nothing sane, so a defect there drops
 *  the WHOLE recipe); every `visual` field degrades independently instead
 *  (a corrupt legend position doesn't cost the recipe its channel mapping).
 *  `schemaVersion` must match exactly -- a mismatch is treated the same as
 *  any other structural defect here (drop); `parseRecipe` below gives that
 *  ONE case its own distinct, named error instead. */
function sanitizeRecipeEntry(v: unknown): PlotRecipe | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.schemaVersion !== PLOT_RECIPE_SCHEMA_VERSION) return null;
  if (typeof o.id !== "string" || !o.id) return null;
  // finding 4: unified on the trim check `parseRecipe` already used, so the
  // strict and tolerant paths never again disagree on a whitespace-only name.
  if (typeof o.name !== "string" || !o.name.trim()) return null;
  if (typeof o.technique !== "string" || !isValidTechnique(o.technique)) return null;
  const signature = sanitizeSignatureEntries(o.signature);
  const mapping = sanitizeMapping(o.mapping);
  if (!signature || !mapping) return null;
  // finding 2a: referential integrity across signature <-> mapping. Must run
  // AFTER both individually validate (so `ids` below is only ever built from
  // a well-formed signature list).
  if (hasDuplicateSignatureIds(signature)) return null;
  const signatureIds = new Set(signature.map((e) => e.id));
  if (mappingReferencesUnknownId(mapping, signatureIds)) return null;
  const prov = typeof o.provenance === "object" && o.provenance !== null
    ? (o.provenance as Record<string, unknown>)
    : {};
  return {
    id: o.id,
    name: o.name,
    description: typeof o.description === "string" ? o.description : "",
    createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    modifiedAt: typeof o.modifiedAt === "string" ? o.modifiedAt : "",
    schemaVersion: PLOT_RECIPE_SCHEMA_VERSION,
    provenance: {
      sourceDatasetLabel: typeof prov.sourceDatasetLabel === "string" ? prov.sourceDatasetLabel : "",
      appVersion: typeof prov.appVersion === "string" ? prov.appVersion : "",
    },
    technique: o.technique,
    signature,
    mapping,
    visual: sanitizeVisual(o.visual),
  };
}

/** Validate persisted `.dwk`/workspace `plotRecipes` entries -- drop-
 *  malformed-never-throw, following `lib/quickPlotTemplates.ts`'s
 *  `sanitizeQuickPlotTemplates` shape: each entry validated independently, a
 *  hand-edited or future-schema entry degrades to "dropped", not a load
 *  failure. */
export function sanitizeRecipes(v: unknown): PlotRecipe[] {
  if (!Array.isArray(v)) return [];
  const out: PlotRecipe[] = [];
  for (const e of v) {
    const recipe = sanitizeRecipeEntry(e);
    if (recipe) out.push(recipe);
  }
  return out;
}

/** Parse + validate a single recipe document (an explicit import/paste, the
 *  `lib/template.ts` `parseTemplate` precedent) -- throws with a clear
 *  message rather than degrading, since there is no sane default for "the
 *  file the user explicitly chose to import". A `schemaVersion` that isn't
 *  exactly `PLOT_RECIPE_SCHEMA_VERSION` gets its own named error; every
 *  other structural defect (missing signature/mapping/identity) reuses the
 *  same validators `sanitizeRecipes` does, so "strict" and "tolerant" always
 *  agree on what counts as well-formed. Unrecognized extra top-level keys
 *  are silently tolerated -- only the known fields above are ever read out
 *  of the parsed object, so an extra key just never makes it into the
 *  returned `PlotRecipe`. */
export function parseRecipe(text: string): PlotRecipe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("not a valid plot recipe file (bad JSON)");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("not a plot recipe file");
  const o = parsed as Record<string, unknown>;
  if (o.schemaVersion !== PLOT_RECIPE_SCHEMA_VERSION) {
    throw new Error(`unsupported plot recipe schema version: ${String(o.schemaVersion)}`);
  }
  if (typeof o.name !== "string" || !o.name.trim()) throw new Error("plot recipe needs a name");
  const recipe = sanitizeRecipeEntry(o);
  if (!recipe) throw new Error("plot recipe has malformed identity, signature, or mapping fields");
  return recipe;
}
