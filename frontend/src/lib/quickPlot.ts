// Quick Plot availability + worksheet resolver + technique profile (PR F;
// plan L0.7-L0.11, bounded by L0.14/L0.37). Quick Plot creates a NEW
// editable figure from RECOGNIZED data only -- it must never replace or
// mutate an existing figure, never mutate raw worksheet data, and never
// produce a "plausible generic plot" for unrecognized OR unsupported data.
//
// "Recognized" is a TWO-part gate: (1) `quickPlotProfile` -- a BOUNDED,
// explicit per-technique profile (Sol's review, OPTION 1: bounded, not a
// full schema-signature system -- that stays PR H) deciding whether this
// technique's CANONICAL rendering is one Quick Plot actually knows how to
// build; (2) the finite-pair plottability check below. A technique stamp
// alone was never sufficient (the P1 this module now closes): `xrd.rsm`
// (a 2D reciprocal-space map) used to pass a bare "non-generic" gate and
// Quick Plot would build an ordinary LINE figure out of scattered x/y/z
// map columns -- a scientifically unsupported rendering nothing asked for.
//
// The canonical LINE mapping every allowlisted technique shares: shared-X,
// multi-Y -- every non-x channel plotted against `.time` as an ordinary
// series (`defaultPlotView`/`datasetViewDefaults`'s `xKey: null` seed).
// Per-column explicit-X or XYXY-paired layouts are NEVER re-inferred here;
// that normalization already happened at IMPORT TIME (the parser puts the
// resolved x axis in `.time`, one array, regardless of how the source file
// laid its columns out) -- by the time a Dataset reaches this module, x
// live in exactly one place. A genuinely AMBIGUOUS multi-column mapping
// (more than one plausible x/y pairing, needing the user's own compact
// confirmation -- L0.10) is explicitly OUT of bounds for this bounded
// profile; it needs PR G's Quick Figure Builder, which can ask. This module
// only ever says "this technique's ONE canonical shape is a line plot" or
// refuses with a reason -- it never offers a choice.
//
// `datasetViewDefaults` (store/windowDefaults.ts) is a store-adjacent PURE
// function -- it takes a Dataset and returns a Partial<PlotView>, no
// Zustand get/set. Importing it here is the same shape as the many other
// lib/ modules that already reach into store/ for a leaf helper (toast,
// useApp) -- architecture.test.ts's "lib/ layering guard" only bans lib/ ->
// components/ imports; it does not restrict lib/ -> store/. Verified by
// running that guard's three "lib/ layering guard" tests green with this
// import in place (see the PR report for the exact command).

import { datasetViewDefaults } from "../store/windowDefaults";
import type { LibraryNode } from "./libraryHierarchy";
import { is2DMap } from "./mapdata";
import { defaultPlotView, type PlotView } from "./plotview";
import { techniqueOf } from "./techniqueDefaults";
import type { TechniqueViewMemoryMap } from "./techniqueViewMemory";
import type { DataStruct, Dataset, Technique } from "./types";

/** PR G's Configure Quick Plot / Quick Plot With... arrive with the Quick
 *  Figure Builder -- named once here so every disabled stub (the menu
 *  actions AND the availability gate below) agrees on the wording. */
export const CONFIGURE_QUICK_PLOT_REASON =
  "unrecognized data — Configure Quick Plot arrives with the Quick Figure Builder (PR G)";
export const NO_PLOTTABLE_COLUMNS_REASON = "no plottable columns in this worksheet";
/** A technique whose data is 2D map-shaped (see quickPlotProfile's `is2DMap`
 *  check -- the SAME signal Stage tab routing uses, lib/stagetab.ts). */
export const MAP_DATA_REASON = "2D map data — open it in the Map view; Quick Plot line figures don't apply";
/** Fail-closed default for a technique that is neither generic, on the line
 *  allowlist, nor map-shaped -- most likely a FUTURE technique tag this
 *  table hasn't been taught yet. Never silently treated as line-plottable. */
export const UNSUPPORTED_TECHNIQUE_REASON =
  "this data type isn't supported by Quick Plot yet — Configure Quick Plot arrives with the Quick Figure Builder (PR G)";

/** The techniques whose canonical rendering IS the shared-X, multi-Y dense-
 *  channel line mapping -- an explicit ALLOWLIST, not "everything non-
 *  generic". Adding a technique here is a deliberate claim that its default
 *  plot is exactly that shape; xrd.rsm is deliberately ABSENT (its
 *  canonical view is a 2D map, not a line plot -- see quickPlotProfile). */
const LINE_PLOT_TECHNIQUES: ReadonlySet<Technique> = new Set([
  "magnetometry.mvsh",
  "magnetometry.mvst",
  "xrd.powder",
  "reflectometry",
  "sims",
  "transport",
  "spectroscopy",
]);

export type QuickPlotProfile = { supported: true; mode: "line" } | { supported: false; reason: string };

/** The bounded per-technique profile (Sol's review, OPTION 1): does Quick
 *  Plot know a canonical rendering for this dataset's technique, and if so
 *  which one? `"generic"` keeps its existing PR G reason; a technique on
 *  `LINE_PLOT_TECHNIQUES` is `{ supported: true; mode: "line" }`; anything
 *  else FAILS CLOSED (Sol's requirement for unproven technique/mode
 *  combinations) rather than defaulting to line. `is2DMap` (lib/mapdata.ts)
 *  is the app's own canonical "this is 2D map data" signal -- the same one
 *  Stage tab routing (lib/stagetab.ts's `nextStageTab`/`plotIntentStageTab`)
 *  uses to send a dataset to the Map view instead of the Plot view -- so a
 *  map-shaped dataset (today: xrd.rsm) gets the specific, honest map
 *  reason; a technique that is neither generic, line-allowlisted, nor
 *  map-shaped (a genuinely unknown FUTURE tag) gets the generic fail-closed
 *  reason instead of guessing. */
export function quickPlotProfile(dataset: Dataset): QuickPlotProfile {
  const tech = techniqueOf(dataset);
  if (tech === "generic") return { supported: false, reason: CONFIGURE_QUICK_PLOT_REASON };
  // The canonical data-shape signal outranks the technique tag (Sol
  // follow-up, PR #153): 2D map data refuses a line Quick Plot even when a
  // malformed/future parser stamped it with an allowlisted 1D technique.
  if (is2DMap(dataset.data)) return { supported: false, reason: MAP_DATA_REASON };
  if (LINE_PLOT_TECHNIQUES.has(tech)) return { supported: true, mode: "line" };
  return { supported: false, reason: UNSUPPORTED_TECHNIQUE_REASON };
}

// No dataset payload -- callers that need the dataset already have it (they
// built the availability check FROM it); carrying it here was dead weight
// nothing consumed.
export type QuickPlotAvailability = { available: true } | { available: false; reason: string };

/** Cache the resolved availability keyed on the DataStruct OBJECT identity
 *  (the "thumbnail revision" pattern lib/plotdata.ts's `denseChannelsCache`
 *  already uses): a Dataset's `.data` is a frozen, replaced-not-mutated
 *  object (CLAUDE.md's data contract), so a cache entry is valid for
 *  exactly as long as the object it's keyed on survives -- no separate
 *  invalidation logic needed. Availability is recomputed on every Library
 *  row render (menu gating) and workbook-row gating checks it once per
 *  candidate worksheet, so a repeat call being allocation- and scan-free
 *  matters (P2 review fix). */
const availabilityCache = new WeakMap<DataStruct, QuickPlotAvailability>();

/** Row-by-row, first-match-wins: does channel `c` have at least one row
 *  where BOTH `.time` and the value are finite? Allocation-free (no
 *  `.map()` column copy) and exits at the FIRST qualifying row instead of
 *  counting every pair like `lib/plotdata.ts`'s `finitePairCount` (which
 *  answers "how dense", a different, more expensive question this gate
 *  doesn't need to ask). */
function hasFinitePair(data: DataStruct, channel: number): boolean {
  const { time, values } = data;
  const n = Math.min(time.length, values.length);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(time[i]) && Number.isFinite(values[i][channel])) return true;
  }
  return false;
}

/** The channels a fresh Quick Plot line figure would show: the
 *  `metadata.default_value_channels` parser hint when present and valid
 *  (reflectometry .dat's R+fit pick, etc.), else every channel. Quick Plot
 *  always seeds `xKey: null` (time-as-x), so this deliberately duplicates
 *  ONLY the hint-reading half of `lib/plotdata.ts`'s `defaultDenseChannels`
 *  -- never its O(channels x rows) density-ranking SCAN, which decides
 *  which subset is dense ENOUGH to show by default. That distinction never
 *  changes this gate's boolean answer: `defaultDenseChannels` only ever
 *  NARROWS within a non-empty candidate list (and falls back to the full
 *  list rather than emptying it outright), so its own returned set always
 *  contains the single densest candidate whenever ANY candidate has a
 *  finite pair -- checking "any candidate at all" here is provably
 *  equivalent to checking density-filtered candidates, just without paying
 *  for the ranking scan or its `.map()` allocations. */
function candidateChannels(data: DataStruct): readonly number[] {
  const hint = (data.metadata ?? {})["default_value_channels"];
  if (Array.isArray(hint)) {
    const picks = hint.filter(
      (v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < data.labels.length,
    );
    if (picks.length > 0) return picks;
  }
  return data.labels.map((_, i) => i);
}

function computeQuickPlotAvailability(dataset: Dataset): QuickPlotAvailability {
  const profile = quickPlotProfile(dataset);
  if (!profile.supported) return { available: false, reason: profile.reason };
  const hasPlottablePair = candidateChannels(dataset.data).some((c) => hasFinitePair(dataset.data, c));
  if (!hasPlottablePair) return { available: false, reason: NO_PLOTTABLE_COLUMNS_REASON };
  return { available: true };
}

/** The recognized+plottable gate (L0.7-L0.11): `quickPlotProfile` must
 *  approve this dataset's technique (the bounded per-technique allowlist --
 *  see its doc for why a bare "non-generic" check is not enough) AND at
 *  least one channel has a genuinely finite (x, y) pair against `.time`
 *  (Quick Plot always seeds `xKey: null`, i.e. time-as-x -- see
 *  quickPlotFigureSeed). No header/unit/adjacency inference and no
 *  confirmation dialog -- those need PR G's builder. Cached per `dataset
 *  .data` object identity (P2 review fix) -- see `availabilityCache`'s
 *  doc for why that key is safe. */
export function quickPlotAvailability(dataset: Dataset): QuickPlotAvailability {
  const cached = availabilityCache.get(dataset.data);
  if (cached) return cached;
  const result = computeQuickPlotAvailability(dataset);
  availabilityCache.set(dataset.data, result);
  return result;
}

/** L0.11's Quick Plot worksheet resolver for a workbook -- DISTINCT from
 *  L0.6's remembered-child resolver (`libraryOpen.ts`'s
 *  `openWorkbookRemembered`/`opensInStage`), which opens ANY remembered
 *  child kind and falls back to "first worksheet" unconditionally. This one
 *  additionally requires the candidate to pass `quickPlotAvailability`, with
 *  a STRICT no-silent-substitution rule for a remembered WORKSHEET
 *  (contract decision, L0.11): (1) if the remembered child is a worksheet,
 *  it is a deliberate destination -- return it if it passes
 *  `quickPlotAvailability`, else return null OUTRIGHT (never fall through
 *  to a different sheet the user didn't pick); (2) only when the remembered
 *  key is ABSENT or names a NON-worksheet child (a figure, a report -- L0.6
 *  remembers those too) does this fall through to the first worksheet in
 *  source order (children are already source-ordered by the hierarchy
 *  builder) that passes `quickPlotAvailability`; (3) else null. */
export function pickQuickPlotWorksheet(
  children: readonly LibraryNode[],
  workbookLastChild: Record<string, string>,
  workbookId: string,
): Dataset | null {
  const rememberedKey = workbookLastChild[workbookId];
  const remembered = rememberedKey ? children.find((c) => c.key === rememberedKey) : undefined;
  if (remembered && remembered.kind === "worksheet") {
    return quickPlotAvailability(remembered.entity).available ? remembered.entity : null;
  }
  for (const child of children) {
    if (child.kind !== "worksheet") continue;
    if (quickPlotAvailability(child.entity).available) return child.entity;
  }
  return null;
}

/** Resolve the worksheet a workbook-level Configure Quick Plot action edits.
 * Unlike Quick Plot itself, configuration intentionally accepts unknown or
 * currently unplottable data: use the remembered worksheet when present,
 * otherwise the first worksheet in source order. This deliberately diverges
 * from `pickQuickPlotWorksheet`'s fallback when the remembered child is NOT
 * a worksheet (e.g. a figure): Quick Plot falls back to the first AVAILABLE
 * worksheet (skipping unrecognized ones), while Configure falls back to the
 * literal first worksheet in source order regardless of availability -- it
 * must work on workbooks with zero recognized sheets, since configuring
 * unknown data is the whole point of the builder. */
export function pickConfigureQuickPlotWorksheet(
  children: readonly LibraryNode[],
  workbookLastChild: Record<string, string>,
  workbookId: string,
): Dataset | null {
  const rememberedKey = workbookLastChild[workbookId];
  const remembered = rememberedKey ? children.find((child) => child.key === rememberedKey) : undefined;
  if (remembered?.kind === "worksheet") return remembered.entity;
  return children.find((child): child is Extract<LibraryNode, { kind: "worksheet" }> =>
    child.kind === "worksheet")?.entity ?? null;
}

/** The new editable figure's name + starting view: the app's normal fresh
 *  view (`defaultPlotView`) overlaid with this dataset's technique-driven
 *  defaults (axis scale, channel/error selection, hidden channels --
 *  `store/windowDefaults.ts`'s `datasetViewDefaults`, the SAME table a
 *  silent import/switch auto-plot uses) AND, when the caller supplies one,
 *  a remembered per-technique view (`memory` -- `lib/techniqueViewMemory
 *  .ts`'s `TechniqueViewMemoryMap`, e.g. AppState.techniqueViewMemory) so a
 *  remembered MvsH view applies just like a silent dataset switch would.
 *  `datasetViewDefaults` already seeds `errKeys` (`defaultErrKeys`) and
 *  `hiddenChannels` (`originHiddenChannels`) from the dataset's own error-
 *  role/Origin-designation metadata, so a dataset with paired error columns
 *  or Origin-hidden X/error columns gets those carried into the seed for
 *  free -- this is the canonical mapping ALREADY handling them, not new
 *  inference layered on top.
 *
 *  Creation consumes the SAME `quickPlotProfile` resolution `quickPlot
 *  Availability` composes (one source of truth for both -- Sol's review):
 *  the `switch` below is deliberately exhaustive over `QuickPlotProfile`'s
 *  `mode` union so a FUTURE mode (added the day this bounded allowlist
 *  grows) fails to compile here until it earns its own creation branch,
 *  instead of silently falling through to the line mapping. Reaching the
 *  `!profile.supported` branch is a caller-contract violation --
 *  store/quickPlotAction.ts's `quickPlotDataset` is the sole caller and
 *  always gates on `quickPlotAvailability` (hence this same profile) first. */
export function quickPlotFigureSeed(
  dataset: Dataset,
  memory: TechniqueViewMemoryMap = {},
): { name: string; view: PlotView } {
  const profile = quickPlotProfile(dataset);
  if (!profile.supported) {
    throw new Error(`quickPlotFigureSeed called on an unsupported dataset ("${dataset.name}")`);
  }
  switch (profile.mode) {
    case "line":
      return {
        name: `Quick Plot — ${dataset.name}`,
        view: { ...defaultPlotView(), ...datasetViewDefaults(dataset, undefined, memory) },
      };
  }
}

export interface QuickPlotWorkbookGate {
  enabled: boolean;
  /** "" when enabled -- only meaningful when `enabled` is false. */
  reason: string;
}

/** The workbook-row "Quick Plot" gate (L0.36): enabled exactly when
 *  `pickQuickPlotWorksheet` resolves. When it doesn't, pick the MOST
 *  SPECIFIC honest reason available: a remembered WORKSHEET that itself
 *  failed availability is why the resolver refused (the strict rule above)
 *  -- surface ITS specific reason, never a different sheet's; otherwise, no
 *  worksheets at all; every worksheet failing `quickPlotAvailability` for
 *  the identical reason (most commonly "every candidate is unrecognized");
 *  or the generic "none qualify" when the failures are a mix and no single
 *  reason covers all of them. */
export function quickPlotWorkbookGate(
  children: readonly LibraryNode[],
  workbookLastChild: Record<string, string>,
  workbookId: string,
): QuickPlotWorkbookGate {
  if (pickQuickPlotWorksheet(children, workbookLastChild, workbookId)) {
    return { enabled: true, reason: "" };
  }
  const rememberedKey = workbookLastChild[workbookId];
  const remembered = rememberedKey ? children.find((c) => c.key === rememberedKey) : undefined;
  if (remembered && remembered.kind === "worksheet") {
    const a = quickPlotAvailability(remembered.entity);
    if (!a.available) return { enabled: false, reason: a.reason };
  }
  const worksheets = children.filter(
    (c): c is Extract<LibraryNode, { kind: "worksheet" }> => c.kind === "worksheet",
  );
  if (worksheets.length === 0) {
    return { enabled: false, reason: "this workbook has no worksheets" };
  }
  const reasons = new Set(
    worksheets.map((w) => {
      const a = quickPlotAvailability(w.entity);
      return a.available ? "" : a.reason;
    }),
  );
  if (reasons.size === 1) {
    const only = [...reasons][0];
    if (only) return { enabled: false, reason: only };
  }
  return { enabled: false, reason: "no plottable worksheet in this workbook" };
}
