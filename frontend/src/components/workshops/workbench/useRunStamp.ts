// Shared workbench shell (lane WB4): the "Out of date" half of the contract for
// a tool that cannot run on `useWorkbenchPreview` (a poll-model job with its
// own Cancel and StatusBar op, hand-edited working state): it still keeps its
// own run, but stamps each result with the key it was launched with and reports
// `stale` when the live key has moved on. The tool must also withhold whatever
// would report, export, save or draw the result while `stale` (see
// OutOfDateNote in WorkbenchParts).
//
// - `launchKey()` is read when a run STARTS: a setting changed while the run is
//   in flight then leaves the landed result stale, never current.
// - `record(key)` stamps the result that just landed; `record(null)` forgets it
//   (Clear, a failed run, a dropped result).
//
// - A key taken BEFORE a lazy Origin book installs stays the live key after the
//   install when nothing but the book arrived (inputsKey's lazy lineage, lane LZ),
//   so such a run lands current; a user edit still moves the key and marks it stale.
//
// Pure React: no store or API imports.

import { useState } from "react";

import { useLatestRef } from "../../../lib/previewKey";

export interface RunStamp {
  /** The key a run started now is asked with. */
  launchKey: () => string;
  /** Stamp the result that landed with the key its run launched with (null forgets it). */
  record: (key: string | null) => void;
  /** A stamped result exists and its key is not the live one. */
  stale: boolean;
}

export function useRunStamp(liveKey: string): RunStamp {
  const [stamped, setStamped] = useState<string | null>(null);
  const live = useLatestRef(liveKey);
  return {
    launchKey: () => live.current,
    record: setStamped,
    stale: stamped !== null && stamped !== liveKey,
  };
}
