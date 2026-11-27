// Persisted view state that is not an undoable edit, composed into useApp as
// ONE slice: the Library Details columns (store/libraryDetailsColumns.ts) and
// the ternary workshop's per-dataset settings (store/ternaryFiguresSlice.ts).
// Both round-trip the project file, both are excluded from undo history
// (architecture.test.ts HISTORY_EXCLUDED), and both are watched by the shared
// autosave trigger (store/autosaveTrigger.ts). Grouping the family keeps
// store/useApp.ts (store-size ratchet) at one registration for it; a new
// member of the same kind is added here, not there. `namedRanges` (store/
// namedRanges.ts, whose writers load on demand) is the exception to "not an
// undoable edit": it IS undoable (HistorySnapshot), only its initial value is here.

import { createLibraryDetailsColumnsSlice, type LibraryDetailsColumnsSlice } from "./libraryDetailsColumns";
import type { NamedRangesSlice } from "./namedRanges";
import { createTernaryFiguresSlice, type TernaryFiguresSlice } from "./ternaryFiguresSlice";

type SliceSet = Parameters<typeof createLibraryDetailsColumnsSlice>[0] & Parameters<typeof createTernaryFiguresSlice>[0];

export type PersistedViewStateSlice = LibraryDetailsColumnsSlice & TernaryFiguresSlice & NamedRangesSlice;

export function createPersistedViewStateSlice(set: SliceSet): PersistedViewStateSlice {
  return { ...createLibraryDetailsColumnsSlice(set), ...createTernaryFiguresSlice(set), namedRanges: [] };
}
