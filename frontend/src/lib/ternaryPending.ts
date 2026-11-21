// One pending set of ternary-workshop column picks, handed from an Origin
// ternary figure apply (`lib/originFigureMap.ts`) to the workshop's state hook
// (`components/workshops/ternary/useTernary.ts`), which takes it when it next
// (re)derives its picks for that dataset. The workshop's open flag lives in
// components/ (`auxFigureStore`), which lib/ and store/ may not import: that
// store registers its opener here instead (`setTernaryOpener`); the pie
// workshop opens through the same seam (`openAuxFigure`, lib/piePending.ts).

export interface PendingTernaryPicks {
  datasetId: string;
  a: number;
  b: number;
  c: number;
}

let pending: PendingTernaryPicks | null = null;
/** An aux-figure workshop's open flag (`auxFigureStore`). */
export type AuxFigureFlag = "ternaryOpen" | "pieOpen";
let opener: ((flag: AuxFigureFlag) => void) | null = null;

/** Registered by the aux-figure workshops' open-flag store. */
export function setTernaryOpener(open: (flag: AuxFigureFlag) => void): void {
  opener = open;
}

/** Queue `picks` and open the ternary workshop. A workshop already open on
 *  the same dataset keeps its current picks until that dataset is re-entered. */
export function requestTernaryPicks(picks: PendingTernaryPicks): void {
  pending = picks;
  openAuxFigure("ternaryOpen");
}

/** Open the aux-figure workshop behind `flag`. */
export function openAuxFigure(flag: AuxFigureFlag): void {
  opener?.(flag);
}

/** The pending picks for `datasetId` (consumed), else null. */
export function takeTernaryPicks(datasetId: string | null | undefined): PendingTernaryPicks | null {
  if (!pending || pending.datasetId !== datasetId) return null;
  const out = pending;
  pending = null;
  return out;
}
