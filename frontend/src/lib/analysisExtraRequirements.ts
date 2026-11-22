// Requirements beyond the kind in ANALYSIS_TOOL_METADATA (worksheet count, 2θ
// axis). Shared by the Analyze menu / palette (lib/analysisRequirements.ts) and
// the Analysis Center's compatibility() (lib/analysisCenter.ts); kept in its own
// module so neither imports the other.

import { xAxisIsTwoThetaDegrees, xChannelIdentity } from "./peakTableFit";
import type { Dataset } from "./types";

export interface RequirementContext {
  dataset: Dataset | undefined;
  /** Every worksheet in the project (the "N or more worksheets" check). */
  datasets: readonly Dataset[];
}

/** A predicate returns the reason it is NOT met, or undefined when it is. */
export type Predicate = (ctx: RequirementContext) => string | undefined;

const withData = (check: (ds: Dataset) => string | undefined): Predicate => (ctx) => (ctx.dataset ? check(ctx.dataset) : undefined);

const twoSheets: Predicate = ({ datasets }) => (datasets.length >= 2 ? undefined : "Needs 2 or more worksheets");
// A lazy preview carries no x metadata yet; do not call it "not 2θ".
const twoTheta: Predicate = withData((ds) =>
  ds.pending || xAxisIsTwoThetaDegrees(xChannelIdentity(ds.data, null)) ? undefined : "Needs a 2θ X axis",
);

/** Requirements beyond the kind in ANALYSIS_TOOL_METADATA. Williamson-Hall is
 *  deliberately absent: it accepts typed peak positions, so any worksheet works. */
export const EXTRA_REQUIREMENTS: Readonly<Record<string, readonly Predicate[]>> = {
  "average-curves": [twoSheets],
  "reductions-pawley": [twoTheta],
  "reductions-reference": [twoTheta],
};

