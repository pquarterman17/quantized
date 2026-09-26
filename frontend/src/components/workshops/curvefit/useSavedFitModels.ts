// The saved fit-model library as a React value that stays CURRENT (PR #432
// review): localStorage has no same-tab change event, so this subscribes to
// lib/fitmodels.ts's write notification and re-reads after every save,
// delete, or project open that merged models in — whichever panel made it —
// and after another window's write (its `storage` event).
// A `useState(loadCustomModelsChecked)` snapshot went stale the moment any
// other surface wrote the library.

import { useMemo, useSyncExternalStore } from "react";

import {
  customModelsRevision,
  loadCustomModelsChecked,
  subscribeCustomModels,
  type CheckedCustomModels,
} from "../../../lib/fitmodels";

export function useSavedFitModels(): CheckedCustomModels {
  const revision = useSyncExternalStore(subscribeCustomModels, customModelsRevision);
  // `revision` is the cache key (read here only to say so): one storage read
  // per library write, not one per render.
  return useMemo(() => {
    void revision;
    return loadCustomModelsChecked();
  }, [revision]);
}
