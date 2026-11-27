// The link status of every mirror column on a worksheet, keyed by its full
// column index, or undefined when it has none (the common case: no store
// subscription cost beyond one selector returning a constant).

import { useMemo } from "react";

import { mirrorStatus, type MirrorStatus } from "../../../lib/mirrorColumn";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

export function useMirrorBadges(ds: Dataset): Record<number, MirrorStatus> | undefined {
  const formulas = ds.formulas;
  const any = formulas?.some((f) => f.sheets?.length === 1) ?? false;
  // Only a sheet that has a one-link formula watches the other worksheets.
  const datasets = useApp((s) => (any ? s.datasets : null));
  return useMemo(() => {
    if (!any || !datasets || !formulas) return undefined;
    const base = ds.data.labels.length - formulas.length;
    const out: Record<number, MirrorStatus> = {};
    formulas.forEach((_, i) => {
      const st = mirrorStatus(ds, i, datasets);
      if (st) out[base + i] = st;
    });
    return Object.keys(out).length ? out : undefined;
  }, [any, datasets, ds, formulas]);
}
