import { useMemo, useState } from "react";

import { compareKey, pickCompareIds, runMagSeriesCompare, type CompareReadout } from "../../../store/magSeriesCompareRun";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { magColumns } from "./magInputs";

export function useMagSeriesCompare() {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const selectedIds = useApp((s) => s.selectedIds);
  const [busy, setBusy] = useState(false);
  const [readout, setReadout] = useState<CompareReadout | null>(null);
  const channel = active ? (active.data.labels[magColumns(active, xKey, yKeys, seriesOrder).yKey] ?? "") : "";
  const picked = useMemo(() => pickCompareIds(active?.id ?? null, selectedIds), [active?.id, selectedIds]);
  const problem = picked.problem
    ?? (!channel ? "The plotted response has no name, so other worksheets cannot be matched to it." : null)
    ?? (xKey !== null ? "The comparison reads each worksheet's own X axis; set the plot X to the worksheet's X axis first." : null);
  const liveKey = compareKey(picked.ids, channel);

  async function compare(): Promise<void> {
    if (problem || !active) return;
    setBusy(true);
    setReadout(null);
    try {
      setReadout(await runMagSeriesCompare(picked.ids, channel));
    } finally {
      setBusy(false);
    }
  }

  // Shown while the worksheets it is about (or the comparison it wrote) is active;
  // on the first source it also says so when the selection or response moved.
  const mine = !!readout && !!active && readout.owners.includes(active.id);
  const stale = mine && active?.id === readout!.owners[0] && readout!.key !== liveKey;
  return { channel, problem, busy, compare, count: picked.ids.length, shown: mine && !stale ? readout : null, stale };
}
