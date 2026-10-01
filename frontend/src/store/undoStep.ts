// One user gesture, one undo entry: the SYNCHRONOUS twin of
// `components/workshops/pipeline/runTemplate.ts`'s `asOneUndoStep`.
//
// Some gestures are built from several store actions that each record their
// own history entry (a Graph Builder commit runs setXKey, setYKeys, a style per
// Y channel, ...; an Origin figure apply may create a window AND an overlay
// dataset). Without folding, Ctrl+Z steps back through half-applied states.
// `foldHistorySince` (store/history.ts) collapses everything `fn` pushed into
// ONE entry holding the state from before `fn` ran. When `fn` pushed nothing,
// nothing is folded and no entry appears — a refused or no-op gesture leaves
// the stack untouched. A gesture that mutates WITHOUT recording must still call
// `recordHistory` itself inside `fn`.
//
// Synchronous on purpose: nothing can land between the snapshot and the fold,
// so the async variant's "an unrelated edit folds in" limitation cannot arise.
//
// Takes `get` rather than importing `useApp`, so a store slice can use it
// without an import cycle.

import { snapshotOf } from "./historySnapshot";
import type { AppState } from "./useApp";

export function asOneEditStep<T>(get: () => AppState, label: string, fn: () => T): T {
  const history = get().history;
  const sinceSeq = history[history.length - 1]?.seq;
  const snapshot = snapshotOf(get());
  try {
    return fn();
  } finally {
    get().foldHistorySince(sinceSeq, label, snapshot);
  }
}
