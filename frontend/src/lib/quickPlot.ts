// Quick Plot availability + worksheet resolver (PR F; plan L0.7-L0.11,
// bounded by L0.14/L0.37). Quick Plot creates a NEW editable figure from
// RECOGNIZED data only -- it must never replace/mutate an existing figure,
// never mutate raw worksheet data, and never produce a "plausible generic
// plot" for unrecognized data. "Recognized" here is intentionally narrow: a
// non-"generic" backend-stamped technique AND at least one genuinely
// plottable channel. Template matching, "Quick Plot With...", and the Quick
// Figure Builder's schema-signature inference are PR G/H -- this module
// never reaches for those; unavailable states carry a precise reason
// instead of guessing.
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
import { defaultDenseChannels, finitePairCount } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import { techniqueOf } from "./techniqueDefaults";
import type { TechniqueViewMemoryMap } from "./techniqueViewMemory";
import type { Dataset } from "./types";

/** PR G's Configure Quick Plot / Quick Plot With... arrive with the Quick
 *  Figure Builder -- named once here so every disabled stub (the menu
 *  actions AND the availability gate below) agrees on the wording. */
export const CONFIGURE_QUICK_PLOT_REASON =
  "unrecognized data — Configure Quick Plot arrives with the Quick Figure Builder (PR G)";
export const NO_PLOTTABLE_COLUMNS_REASON = "no plottable columns in this worksheet";
/** Shared by the dataset AND workbook "Configure Quick Plot…" stubs
 *  (lib/quickPlotActions.ts, lib/workbookContextActions.ts) so both honest
 *  disabled placeholders agree on the wording. */
export const CONFIGURE_QUICK_PLOT_STUB_REASON = "arrives with the Quick Figure Builder (PR G)";

// No dataset payload -- callers that need the dataset already have it (they
// built the availability check FROM it); carrying it here was dead weight
// nothing consumed.
export type QuickPlotAvailability = { available: true } | { available: false; reason: string };

/** The recognized+plottable gate (L0.7-L0.11): `techniqueOf(dataset) !==
 *  "generic"` AND at least one channel has a genuinely finite (x, y) pair
 *  against `.time` (Quick Plot always seeds `xKey: null`, i.e. time-as-x --
 *  see quickPlotFigureSeed). A single `labels` entry is a REAL channel
 *  (DataStruct.labels never contains an index/x column -- that's `.time`,
 *  a separate array; "Plot (make active)" already draws such datasets
 *  fine), so there is no separate "bare column" guard here -- only the
 *  finite-pair check below, which also catches the degenerate cases (all-
 *  NaN values, or an all-NaN `.time` with otherwise-finite values -- a
 *  dataset with genuinely no x to plot against). No header/unit/adjacency
 *  inference and no confirmation dialog -- those need PR G's builder. */
export function quickPlotAvailability(dataset: Dataset): QuickPlotAvailability {
  if (techniqueOf(dataset) === "generic") {
    return { available: false, reason: CONFIGURE_QUICK_PLOT_REASON };
  }
  const channels = defaultDenseChannels(dataset.data, null);
  const xs = dataset.data.time;
  const hasPlottablePair =
    channels.length > 0 &&
    channels.some((c) => finitePairCount(xs, dataset.data.values.map((row) => row[c])) > 0);
  if (!hasPlottablePair) {
    return { available: false, reason: NO_PLOTTABLE_COLUMNS_REASON };
  }
  return { available: true };
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

/** The new editable figure's name + starting view: the app's normal fresh
 *  view (`defaultPlotView`) overlaid with this dataset's technique-driven
 *  defaults (axis scale, channel/error selection, hidden channels --
 *  `store/windowDefaults.ts`'s `datasetViewDefaults`, the SAME table a
 *  silent import/switch auto-plot uses) AND, when the caller supplies one,
 *  a remembered per-technique view (`memory` -- `lib/techniqueViewMemory
 *  .ts`'s `TechniqueViewMemoryMap`, e.g. AppState.techniqueViewMemory) so a
 *  remembered MvsH view applies just like a silent dataset switch would. A
 *  Quick Plot's starting point is therefore indistinguishable from any
 *  other freshly-bound window, not a bespoke rendering path -- and it stays
 *  fully editable after. `datasetViewDefaults` is called with no `previous`
 *  dataset (Quick Plot creates a fresh figure, not a window rebind) --
 *  `undefined` always counts as "a technique change", so the technique
 *  table applies whenever `memory` has nothing remembered yet. */
export function quickPlotFigureSeed(
  dataset: Dataset,
  memory: TechniqueViewMemoryMap = {},
): { name: string; view: PlotView } {
  return {
    name: `Quick Plot — ${dataset.name}`,
    view: { ...defaultPlotView(), ...datasetViewDefaults(dataset, undefined, memory) },
  };
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
