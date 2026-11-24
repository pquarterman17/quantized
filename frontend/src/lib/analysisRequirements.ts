// Declarative input requirements for the Analyze menu + command palette.
//
// ANALYSIS_TOOL_METADATA (lib/analysisCenter.ts) already says what KIND of
// input each tool needs (`requirement`) and which techniques it targets; this
// module turns that into one-line, menu-sized reasons and adds the two
// requirements the Analysis Center never checked (worksheet count, 2θ axis)
// as a small EXTRA table. Menu and palette read the same predicate through
// `withAnalysisRequirements`, so a disabled menu item is disabled in the
// palette with the identical reason. Lazy-only: never import from eager code.

import { ANALYSIS_TOOL_METADATA, dimensions, type AnalysisToolMetadata } from "./analysisCenter";
import { canRenderMap, mapGateResolved } from "./mapdata";
import { EXTRA_REQUIREMENTS, type Predicate, type RequirementContext } from "./analysisExtraRequirements";
import { techniqueOf } from "./techniqueDefaults";
import type { Dataset } from "./types";
import type { Action } from "../store/commands";
import { NEEDS_DATASET } from "./menuReasons";

export { EXTRA_REQUIREMENTS };
export type { RequirementContext };

const needsDataset: Predicate = ({ dataset }) => (dataset ? undefined : NEEDS_DATASET);
const withData = (check: (ds: Dataset) => string | undefined): Predicate => (ctx) => (ctx.dataset ? check(ctx.dataset) : undefined);

/** Base predicates, keyed by the Analysis Center's `requirement` kind. */
const BASE: Record<AnalysisToolMetadata["requirement"], readonly Predicate[]> = {
  none: [],
  dataset: [needsDataset, withData((ds) => (dimensions(ds).rows < 2 ? "Needs at least 2 data rows" : undefined))],
  continuous: [
    needsDataset,
    withData((ds) => (dimensions(ds).rows < 3 ? "Needs at least 3 data rows" : undefined)),
    withData((ds) => (dimensions(ds).numericResponses < 1 ? "Needs a numeric Y column" : undefined)),
  ],
  "two-continuous": [needsDataset, withData((ds) => (dimensions(ds).numericColumns < 2 ? "Needs 2 or more numeric columns" : undefined))],
  "three-continuous": [needsDataset, withData((ds) => (dimensions(ds).numericColumns < 3 ? "Needs 3 or more numeric columns (X, Y, Z)" : undefined))],
  variability: [
    needsDataset,
    withData((ds) => {
      const size = dimensions(ds);
      return size.numericColumns < 1 || size.columns < 3 ? "Needs a numeric response and 2 factor columns" : undefined;
    }),
  ],
  // A lazy Origin preview or an unclassified grid is not "no map": stay enabled.
  map: [needsDataset, withData((ds) => (ds.pending || !mapGateResolved(ds.data) || canRenderMap(ds.data) ? undefined : "Needs a 2-D map (x, y, intensity)"))],
};

/** Display names for technique families: acronyms are upper case, the rest read as words. */
const TECHNIQUE_NAMES: Readonly<Record<string, string>> = { xrd: "XRD", sims: "SIMS" };

function techniqueReason(meta: AnalysisToolMetadata, ctx: RequirementContext): string | undefined {
  if (!ctx.dataset || !meta.techniques) return undefined;
  const technique = techniqueOf(ctx.dataset);
  if (technique === "generic" || meta.techniques.includes(technique)) return undefined;
  const family = meta.techniques[0]!.split(".")[0]!;
  return `Needs ${TECHNIQUE_NAMES[family] ?? family} data`;
}

/** The first unmet requirement of Analyze tool `id`, or undefined when the
 *  active worksheet fits (or the id is not a metadata-described tool). */
export function analysisUnavailableReason(id: string, ctx: RequirementContext): string | undefined {
  const meta = ANALYSIS_TOOL_METADATA[id];
  if (!meta) return undefined;
  const missing = meta.requirement === "none" ? undefined : needsDataset(ctx);
  if (missing) return missing;
  const wrongTechnique = techniqueReason(meta, ctx);
  if (wrongTechnique) return wrongTechnique;
  for (const predicate of [...BASE[meta.requirement], ...(EXTRA_REQUIREMENTS[id] ?? [])]) {
    const reason = predicate(ctx);
    if (reason) return reason;
  }
  return undefined;
}

/** Give every metadata-described Analyze action live `disabled` /
 *  `disabledReason` driven by the current worksheet. `read` supplies the
 *  context at evaluation time (menu render / palette open), never build time. */
export function withAnalysisRequirements(actions: Action[], read: () => RequirementContext): Action[] {
  return actions.map((action) => {
    if (action.group !== "Analyze" || !ANALYSIS_TOOL_METADATA[action.id]) return action;
    const reason = () => analysisUnavailableReason(action.id, read());
    return { ...action, disabled: () => reason() !== undefined, disabledReason: reason };
  });
}
