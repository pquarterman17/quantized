// The active worksheet as a group-by picker sees it: every channel plus each CSV
// text column that can group rows, appended as a categorical channel
// (lib/groupableColumns, the rule the Statistics stage uses). A column keeps ONE
// reference everywhere: its channel index in this dataset (real channels first,
// then the text columns in sidecar order), re-found by LABEL when the sheet's
// columns change (useFollowColumnPicks) and saved by label in presets.
//
// Use it for the column list, the pick defaults and the rows the tool analyses.
// Keep the REAL dataset (`useActiveDataset`) for anything that identifies the
// sheet: its fingerprint, a committed output's source, the result's provenance.

import { withTextGroupChannels } from "../../lib/groupableColumns";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

/** The active dataset with its groupable text columns appended (the same object
 *  while the dataset is unchanged), or null. */
export function useGroupableActive(): Dataset | null {
  return useApp((s) => {
    const active = s.datasets.find((d) => d.id === s.activeId);
    return active ? withTextGroupChannels(active) : null;
  });
}
