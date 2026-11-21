// One pending pie / doughnut request, handed from an Origin pie figure apply
// (`lib/originFigureMap.ts`) to the pie workshop's state hook
// (`components/workshops/pie/usePie.ts`), which takes it when it next
// (re)derives its picks for that dataset — the `lib/ternaryPending` shape.
// LAZY: imported only by those two lazy modules, never by eager code (the
// workshop opens through `ternaryPending.openAuxFigure`, already eager).

import { openAuxFigure } from "./ternaryPending";

export interface PendingPie {
  datasetId: string;
  /** Channel holding the wedge labels; -1 = the X column. */
  labels: number;
  /** One channel per ring, the first innermost. */
  values: number[];
  /** Hole radius / outer radius (0 = a plain pie). */
  hole: number;
}

let pending: PendingPie | null = null;

/** Queue `pie` and open the pie workshop. */
export function requestPie(pie: PendingPie): void {
  pending = pie;
  openAuxFigure("pieOpen");
}

/** The pending pie for `datasetId` (consumed), else null. */
export function takePie(datasetId: string | null | undefined): PendingPie | null {
  if (!pending || pending.datasetId !== datasetId) return null;
  const out = pending;
  pending = null;
  return out;
}
