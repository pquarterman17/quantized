// The Export flow shared by the ternary and vector-field workshops: resolve
// the active dataset (lib/exportActive — one cancellable StatusBar op, the
// standard status/toast wording), honour the app's excluded-rows state, build
// the request from the ANALYSIS view and send it through the figure route.
//
// Excluded rows are OMITTED here, never greyed: these routes take bare
// compositions / a bare grid and have no per-row style channel, so the
// export still asks, with only the omit option and the reason, so rows are
// never dropped without saying so (the faceted xy export greys them since
// 2026-10-01; a misaligned facet grid is the one that still omits, with
// lib/excludedRowsExport.FACET_OMIT_REASON). The preview draws the same
// pruned view.

import { askExcludedRows } from "../../../lib/excludedRowsChoice";
import { exportActive } from "../../../lib/exportActive";
import { withTextGroupChannels } from "../../../lib/groupableColumns";
import { analysisData, droppedRows } from "../../../lib/rowstate";
import { windowForExport } from "./auxRowWindow";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

export const AUX_OMIT_REASON =
  "This figure cannot draw excluded rows grayed, so the export leaves them out.";

export interface AuxExport<Spec> {
  /** The request over the ANALYSIS view; `stem` is the dataset name sans extension. */
  build: (data: DataStruct, stem: string) => Spec | null;
  send: (spec: Spec, signal: AbortSignal) => Promise<void>;
  /** Why `build` returned null — surfaces as the export-failed toast. */
  empty: string;
  /** Cut the sheet to the plot's row window first (every figure that has a row window). A window that cannot be applied
   *  is refused. Absent: the figure draws every row (the pie workshop). */
  rowWindow?: boolean;
  /** The figure may pick the sheet's CSV text columns as categories: they are appended as channels
   *  (lib/groupableColumns) before the request is built, as the Stage preview's own picks index them. */
  textGroups?: boolean;
}

export function exportAuxFigure<Spec>(opts: AuxExport<Spec>): Promise<void> {
  const store = useApp.getState;
  return exportActive(store, async (stem, full, signal) => {
    const windowed = opts.rowWindow ? windowForExport(full, store().rowRange) : full;
    const ds = opts.textGroups ? withTextGroupChannels(windowed) : windowed;
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
