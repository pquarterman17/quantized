// The worksheet's "Set As" menu (components/Stage/worksheet/worksheetMenus.ts)
// and its action (store/columnDesignationActions.ts) share this list. Its own
// module so it rides in the worksheet's chunk, not with the eager designation
// readers in lib/columnmeta.ts.

import type { OriginDesignation } from "./columnmeta";

/** Origin's own Set As list, order and wording, as `[designation, menu
 *  label]` pairs. */
export const SET_AS_CHOICES: readonly (readonly [OriginDesignation, string])[] = [
  ["X", "X"],
  ["Y", "Y"],
  ["Z", "Z"],
  ["Y-error", "Y Error"],
  ["X-error", "X Error"],
  ["label", "Label"],
  ["disregard", "Disregard"],
];
