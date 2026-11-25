// The lazy-only half of committedOutputGraph.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the all-outputs id walk and the reopen parameter name. Only the lazy recalc pass and output tools read them.
// The code moved here verbatim and committedOutputGraph.ts re-exports it with `export *`:
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type { AnalysisResult } from "./analysisResult";
import { isCommittedOutputResult } from "./committedOutputGraph";

/** The envelope parameter with what "Open in <tool>" needs beyond the keyed
 *  settings (lib/committedOutputReopen.ts). */
export const REOPEN_PARAM = "reopen";

/** Every committed output worksheet id (what a recalc pass must not "clear"). */
export function committedOutputIds(results: readonly AnalysisResult[]): Set<string> {
  const ids = new Set<string>();
  for (const result of results) {
    if (isCommittedOutputResult(result)) for (const ref of result.outputs) ids.add(ref.datasetId);
  }
  return ids;
}
