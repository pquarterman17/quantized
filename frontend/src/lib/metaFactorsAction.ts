// The Library dataset row's "Metadata → factors…" entry (audit P2.5). Its own
// module, spliced in by components/Library/datasetRowMenu.ts, rather than in
// lib/contextActions.ts: that module lands in a chunk shared with lazy
// consumers, and importing the workshop's open flag there split the flag into
// an extra EAGER chunk (measured: +1 chunk, ~0.3 kB of the bundle budget).

import type { ContextAction, DatasetActionTarget } from "./contextActions";
import { multiSelected } from "./multiSelected";
import { openMetaFactors } from "../store/metaFactorsDialog";

/** Opens on the whole selection when this row is part of it, else this row. */
export const datasetMetaFactorsAction: ContextAction<DatasetActionTarget> = {
  id: "dataset.metaFactors",
  label: "Metadata → factors…",
  run: (t) => openMetaFactors(multiSelected(t) ? t.selectedIds : [t.dataset.id]),
};
