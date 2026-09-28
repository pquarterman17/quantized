// Built-in Plot Recipes (PRIMARY_SOFTWARE_AUDIT_PLAN P2.1 "Technique-specific
// plot recipe is manually chosen, never auto-overwrites"): a small, fixed
// set of technique-specific recipes shipped with the app -- XRD theta-2theta,
// XRR log-reflectivity, and an M(H) loop -- authored directly on the SAME
// `PlotRecipe` schema `lib/plotRecipe.ts`'s `captureRecipe` produces, rather
// than as a new recipe kind or a second apply path.
//
// SAME APPLY CONTRACT AS ANY SAVED RECIPE (store/plotRecipeApply.ts's
// `resolveApplyOrStage` / `applyResolvedRecipe`, reached via
// `applyPlotRecipeObject`): manual only (a user must pick one and click
// Apply -- see below), one gesture creating a NEW figure (never edits a live
// window in place, so there is nothing for it to "auto-overwrite"), one
// undo step, and the existing unmatched-field preview+confirm dialog
// (`PlotRecipeApplyDialog.tsx`) whenever a target dataset's channel labels
// don't match a signature entry's label/aliases -- there is no second,
// bespoke confirm path for these.
//
// NEVER A CANDIDATE FOR AUTOMATIC APPLICATION. `store/plotRecipeApply.ts`'s
// `resolvedCandidates` (which feeds both `matchingPlotRecipes`'s suggestion
// list and `cleanMatchingPlotRecipe`'s post-import toast, `store/
// importBatchOffers.ts`) reads ONLY `state.plotRecipes` (project) and
// `hydratedGlobalRecipes()` (global) -- `BUILTIN_PLOT_RECIPES` below is a
// member of neither, so it is structurally excluded from every "offer this
// automatically" surface. The ONLY place a person can reach one is the
// Recipe Manager panel's own "Built-in" group (components/workshops/
// recipemanager/RecipeManagerPanel.tsx), applied the same explicit,
// one-at-a-time way as any project/global row.
//
// READ-ONLY BY CONSTRUCTION, not by a flag: these objects are never members
// of `state.plotRecipes` or `store/globalPlotRecipes.ts`'s list, so there is
// no CRUD path that could rename, mutate, or delete one -- the Recipe
// Manager panel renders them with Apply + "Copy to Project" only. Copying
// is the sanctioned way to "edit" one: it lands a normal, fully-editable
// project recipe via the existing `copyPlotRecipeIn` seam; the built-in
// itself is never touched.
//
// Ids are prefixed `builtin:` (see `isBuiltinPlotRecipeId` below) purely as
// an internal marker other code can check without importing this list --
// it is not a schema convention and carries no other meaning. Timestamps
// are a fixed constant (never `Date.now()`): these are shipped, not
// captured, so there is no real "when" to record, and a fixed value keeps
// every render/test deterministic.
//
// CHANNEL LABELS/ALIASES ARE READ OFF THE ACTUAL PARSERS, never invented:
// every XRD parser (`io/bruker_raw.py`, `io/bruker_brml.py`, `io/rigaku.py`,
// `io/xrdml.py`) emits a single `"Intensity"` values column against a
// 2theta `.time` axis; NCNR reflectometry (`io/ncnr.py`) emits `"R"`
// (`.datA`-`.datD` cross sections) or a polarization-cleaned label against
// a Q `.time` axis; the QD VSM/PPMS/MPMS parser (`io/qd.py`) emits
// `"Moment"` against a `"Magnetic Field"` `.time` axis for an M(H) sweep.
// `mapping.xId` stays `null` in every recipe below (no x signature entry is
// captured) so each one binds to whatever the target dataset's OWN `.time`
// axis already is -- exactly like a freshly imported plot's silent default
// (`lib/techniqueDefaults.ts`'s `datasetViewDefaults`) -- these recipes only
// add the axis-scale/reference-line opinion that table doesn't carry.
//
// Axis-scale choices mirror `lib/techniqueDefaults.ts`'s
// `TECHNIQUE_VIEW_DEFAULTS` table verbatim (log intensity for XRD, log R for
// reflectometry, linear for M(H)) -- ported from MATLAB
// `updateControlsForActiveDataset.m` there, not invented here. The M(H)
// loop's zero lines use `RefLine` exactly as ITS OWN doc (`lib/types.ts`)
// names the case ("mark Hc, Tc, zero, a critical edge") -- H=0/M=0 are the
// two axes every hysteresis loop is read against. No fixed/symmetric X range
// is set: a real hysteresis sweep already runs -Hmax..+Hmax, so the
// ordinary `{mode:"auto"}` range already renders symmetric about zero for
// real data, without this module inventing a new range policy to force it.

import type { PlotRecipe, RecipeVisual } from "./plotRecipeSchema";
import { PLOT_RECIPE_SCHEMA_VERSION } from "./plotRecipeSchema";

const BUILTIN_APP_VERSION = "builtin";
// Fixed, not `Date.now()` -- see the module doc.
const BUILTIN_TIMESTAMP = "2026-09-28T00:00:00.000Z";
const BUILTIN_ID_PREFIX = "builtin:";

function builtinVisual(overrides: Partial<RecipeVisual>): RecipeVisual {
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
    refLines: [],
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
    ...overrides,
  };
}

interface OneYRecipeOptions {
  id: string;
  name: string;
  description: string;
  technique: PlotRecipe["technique"];
  yLabel: string;
  yAliases: string[];
  visual: Partial<RecipeVisual>;
}

/** Every built-in today has exactly one Y signature entry (the technique's
 *  single conventional values column) and no X entry -- see the module doc.
 *  A future built-in with a genuinely different shape (e.g. a Y2 series)
 *  would get its own literal `PlotRecipe`, not a forced fit through this
 *  helper. */
function oneYRecipe(opts: OneYRecipeOptions): PlotRecipe {
  return {
    id: `${BUILTIN_ID_PREFIX}${opts.id}`,
    name: opts.name,
    description: opts.description,
    createdAt: BUILTIN_TIMESTAMP,
    modifiedAt: BUILTIN_TIMESTAMP,
    schemaVersion: PLOT_RECIPE_SCHEMA_VERSION,
    provenance: { sourceDatasetLabel: "", appVersion: BUILTIN_APP_VERSION },
    technique: opts.technique,
    signature: [
      {
        id: "y0",
        role: "y",
        label: opts.yLabel,
        unit: "",
        errorRole: "value",
        aliases: opts.yAliases,
      },
    ],
    mapping: { xId: null, yIds: ["y0"], y2Ids: [], groupId: null, facetId: null, errors: [] },
    visual: builtinVisual(opts.visual),
  };
}

/** The fixed built-in Plot Recipe set. Order is the order the Recipe
 *  Manager panel's "Built-in" group renders them in. */
export const BUILTIN_PLOT_RECIPES: readonly PlotRecipe[] = [
  oneYRecipe({
    id: "xrd-theta-2theta",
    name: "XRD θ–2θ",
    description: "Log-scale intensity vs. two-theta -- the standard powder-diffraction scan view.",
    technique: "xrd.powder",
    yLabel: "Intensity",
    yAliases: ["counts", "count", "cps", "intensity (counts)"],
    visual: { yScale: "log" },
  }),
  oneYRecipe({
    id: "xrr-log-reflectivity",
    name: "XRR log R vs Q",
    description: "Log-scale reflectivity vs. the momentum-transfer Q axis.",
    technique: "reflectometry",
    yLabel: "R",
    yAliases: ["reflectivity", "refl"],
    visual: { yScale: "log" },
  }),
  oneYRecipe({
    id: "mh-loop",
    name: "M(H) loop",
    description: "Linear moment vs. field, with zero lines marking H = 0 and M = 0.",
    technique: "magnetometry.mvsh",
    yLabel: "Moment",
    yAliases: ["moment", "dc moment", "m"],
    visual: {
      refLines: [
        { id: "builtin-zero-h", axis: "x", value: 0 },
        { id: "builtin-zero-m", axis: "y", value: 0 },
      ],
    },
  }),
];

/** Is `id` one of the fixed built-in Plot Recipe ids? A pure string check
 *  (never looks the id up in `BUILTIN_PLOT_RECIPES`) so a caller can guard a
 *  read-only affordance (no Rename/Delete) for one it hasn't loaded -- see
 *  the module doc's READ-ONLY note. */
export function isBuiltinPlotRecipeId(id: string): boolean {
  return id.startsWith(BUILTIN_ID_PREFIX);
}
