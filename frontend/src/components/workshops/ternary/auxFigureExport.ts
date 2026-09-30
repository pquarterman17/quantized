// The Export flow shared by the ternary and vector-field workshops: resolve
// the active dataset (lib/exportActive — one cancellable StatusBar op, the
// standard status/toast wording), honour the app's excluded-rows state, build
// the request from the ANALYSIS view and send it through the figure route.
//
// Excluded rows are OMITTED here, never greyed: these routes take bare
// compositions / a bare grid and have no per-row style channel, so — like
// the faceted xy export (lib/excludedRowsExport.FACET_OMIT_REASON) — the
// export still asks, with only the omit option and the reason, so rows are
// never dropped without saying so. The preview draws the same pruned view.

import { askExcludedRows } from "../../../lib/excludedRowsChoice";
import { exportActive } from "../../../lib/exportActive";
import { analysisData, droppedRows } from "../../../lib/rowstate";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

export const AUX_OMIT_REASON =
  "This figure cannot draw excluded rows greyed, so the export leaves them out.";

export interface AuxExport<Spec> {
  /** The request over the ANALYSIS view; `stem` is the dataset name sans extension. */
  build: (data: DataStruct, stem: string) => Spec | null;
  send: (spec: Spec, signal: AbortSignal) => Promise<void>;
  /** Why `build` returned null — surfaces as the export-failed toast. */
  empty: string;
}

export function exportAuxFigure<Spec>(opts: AuxExport<Spec>): Promise<void> {
  const store = useApp.getState;
  return exportActive(store, async (stem, ds, signal) => {
    if (droppedRows(ds).size > 0) {
      const choice = await askExcludedRows(store().excludedDisplay, AUX_OMIT_REASON);
      if (choice === null) return false;
    }
    const data = analysisData(ds);
    const spec = data ? opts.build(data, stem) : null;
    if (!spec) throw new Error(opts.empty);
    await opts.send(spec, signal);
  });
}
