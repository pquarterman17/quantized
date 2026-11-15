// The worksheet column menu's "Modeling type" pick: a thin store-level wrapper
// over `setChannelType` so the menu component never reaches into the store
// itself (architecture.test's getState()-in-render ratchet).

import type { ModelingType } from "../lib/types";
import { useApp } from "./useApp";

/** Override a column's modeling type; `null` clears it back to auto-inferred. */
export function setColumnModelingType(datasetId: string, col: number, t: ModelingType | null): void {
  useApp.getState().setChannelType(datasetId, col, t);
}
