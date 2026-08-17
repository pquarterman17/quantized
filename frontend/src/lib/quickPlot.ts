// Quick Plot availability + worksheet resolver (PR F; plan L0.7-L0.11,
// bounded by L0.14/L0.37). Quick Plot creates a NEW editable figure from
// RECOGNIZED data only -- it must never replace/mutate an existing figure,
// never mutate raw worksheet data, and never produce a "plausible generic
// plot" for unrecognized data. "Recognized" here is intentionally narrow: a
// non-"generic" backend-stamped technique AND at least one plottable channel
// beyond a bare index column. Template matching, "Quick Plot With...", and
// the Quick Figure Builder's schema-signature inference are PR G/H -- this
// module never reaches for those; unavailable states carry a precise reason
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
import { defaultDenseChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import { techniqueOf } from "./techniqueDefaults";
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

export type QuickPlotAvailability =
  | { available: true; dataset: Dataset }
  | { available: false; reason: string };

/** The recognized+plottable gate (L0.7-L0.11): `techniqueOf(dataset) !==
 *  "generic"` AND the dataset is plottable (more than a bare index column,
 *  and `defaultDenseChannels` yields at least one channel). No header/unit/
 *  adjacency inference and no confirmation dialog -- those need PR G's
 *  builder. Distinct, honest reasons per failure mode so a disabled menu
 *  item can say exactly why. */
export function quickPlotAvailability(dataset: Dataset): QuickPlotAvailability {
  if (techniqueOf(dataset) === "generic") {
    return { available: false, reason: CONFIGURE_QUICK_PLOT_REASON };
  }
  // labels.length <= 1: a bare index/time column with nothing else to plot
  // against it. defaultDenseChannels rarely returns [] outright (its
  // "nothing dense" branch falls back to every candidate -- plotdata.ts
  // ~203-210) so this guard is what actually catches the single-column case.
  if (dataset.data.labels.length <= 1) {
    return { available: false, reason: NO_PLOTTABLE_COLUMNS_REASON };
  }
  const channels = defaultDenseChannels(dataset.data, null);
  // defaultDenseChannels' own "nothing is dense" branch falls back to EVERY
  // candidate (plotdata.ts ~203-210: "the plot is never emptied outright") --
  // exactly right for an interactive plot deciding what to SHOW, but wrong
  // for Quick Plot's availability gate, which must say no when a recognized
  // worksheet's channels are entirely NaN rather than hand back an "available"
  // figure with nothing drawable in it. Re-check for at least one finite
  // value among the candidate channels the fallback returned.
  const hasPlottableValue =
    channels.length > 0 &&
    dataset.data.values.some((row) => channels.some((c) => Number.isFinite(row[c])));
  if (!hasPlottableValue) {
    return { available: false, reason: NO_PLOTTABLE_COLUMNS_REASON };
  }
  return { available: true, dataset };
}

/** L0.11's Quick Plot worksheet resolver for a workbook -- DISTINCT from
 *  L0.6's remembered-child resolver (`libraryOpen.ts`'s
 *  `openWorkbookRemembered`/`opensInStage`), which opens ANY remembered
 *  child kind and falls back to "first worksheet" unconditionally. This one
 *  additionally requires the candidate to pass `quickPlotAvailability`:
 *  (1) the remembered child, if it is a worksheet AND plottable; else
 *  (2) the first worksheet in source order (children are already
 *  source-ordered by the hierarchy builder) that is plottable; else
 *  (3) null. A remembered NON-worksheet child (a figure, a report) is
 *  silently ignored -- it just falls through to rule 2, it is never treated
 *  as "no worksheets". */
export function pickQuickPlotWorksheet(
  children: readonly LibraryNode[],
  workbookLastChild: Record<string, string>,
  workbookId: string,
): Dataset | null {
  const rememberedKey = workbookLastChild[workbookId];
  const remembered = rememberedKey ? children.find((c) => c.key === rememberedKey) : undefined;
  if (remembered && remembered.kind === "worksheet" && quickPlotAvailability(remembered.entity).available) {
    return remembered.entity;
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
 *  silent import/switch auto-plot uses). A Quick Plot's starting point is
 *  therefore indistinguishable from any other freshly-bound window, not a
 *  bespoke rendering path -- and it stays fully editable after. */
export function quickPlotFigureSeed(dataset: Dataset): { name: string; view: PlotView } {
  return {
    name: `Quick Plot — ${dataset.name}`,
    view: { ...defaultPlotView(), ...datasetViewDefaults(dataset) },
  };
}

export interface QuickPlotWorkbookGate {
  enabled: boolean;
  /** "" when enabled -- only meaningful when `enabled` is false. */
  reason: string;
}

/** The workbook-row "Quick Plot" gate (L0.36): enabled exactly when
 *  `pickQuickPlotWorksheet` resolves. When it doesn't, pick the MOST
 *  SPECIFIC honest reason available: no worksheets at all; every worksheet
 *  failing `quickPlotAvailability` for the identical reason (most commonly
 *  "every candidate is unrecognized"); or the generic "none qualify" when
 *  the failures are a mix (unrecognized + unplottable, etc.) and no single
 *  reason covers all of them. */
export function quickPlotWorkbookGate(
  children: readonly LibraryNode[],
  workbookLastChild: Record<string, string>,
  workbookId: string,
): QuickPlotWorkbookGate {
  if (pickQuickPlotWorksheet(children, workbookLastChild, workbookId)) {
    return { enabled: true, reason: "" };
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
