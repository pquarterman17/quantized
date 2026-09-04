// The one "is more than one row selected?" rule the dataset context-action
// registries share. A leaf module (type-only import) so both
// lib/contextActions.ts and lib/datasetRemoveActions.ts can import the VALUE
// without the runtime cycle that made the latter inline a copy (self-review
// on #292): the rule now has exactly one definition.

import type { DatasetActionTarget } from "./contextActions";

export const multiSelected = (t: DatasetActionTarget): boolean => t.selected && t.selectedIds.length > 1;
