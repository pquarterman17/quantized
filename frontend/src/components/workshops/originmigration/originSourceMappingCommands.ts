// UI bridge for the lazily loaded Origin fallback module. Keep mapping
// mutations behind the same guarded dynamic-import seam as the other Origin
// recovery commands; importing originFallback.ts here would pull the complete
// recovery implementation into the eager application graph.

import { originFallbackCore } from "../../../store/originFallbackLazy";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";

function loadFailed(error: unknown): false {
  toast(`Couldn't update Origin source mapping — ${error instanceof Error ? error.message : "load failed"}`, "danger");
  return false;
}

export async function commitOriginSourceMapping(
  book: string,
  datasetId: string,
  entryIds: string[],
): Promise<boolean> {
  try {
    const core = await originFallbackCore();
    return core.commitOriginSourceMapping(
      useApp.setState,
      useApp.getState,
      book,
      datasetId,
      entryIds,
    );
  } catch (error: unknown) {
    return loadFailed(error);
  }
}

export async function clearOriginSourceMapping(
  book: string,
  entryIds: string[],
): Promise<boolean> {
  try {
    const core = await originFallbackCore();
    return core.clearOriginSourceMapping(useApp.setState, useApp.getState, book, entryIds);
  } catch (error: unknown) {
    return loadFailed(error);
  }
}
