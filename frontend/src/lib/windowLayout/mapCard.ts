// Which dataset the Style window's 2-D map card describes in windows mode (UX
// pass 4 M2). The card follows the MAP WINDOW the user is working in, not the
// Library-active dataset: with two maps open, an edit lands on the map on top,
// and the card stays while a cut dataset (an H-cut) is active. Document windows
// are never the store's focused window (a click raises them), so "the window in
// use" is the front-most open plot-family window by z:
// - it is a map: its dataset;
// - it is a plot: the active dataset's own open map window, if there is one
//   (what the card did before, so a plot on top does not hide it);
// - otherwise no card.
// Pure; the dataset must exist, since the card names it.

import type { PlotWindow } from "../plotview";
import type { Dataset } from "../types";
import type { WindowLayoutV1 } from "./types";

export function mapCardDatasetId(
  plotWindows: readonly PlotWindow[],
  datasets: readonly Dataset[],
  activeId: string | null,
  layout: WindowLayoutV1 | null,
): string | null {
  const shown = plotWindows.filter((w) => w.winState !== "minimized" && layout?.placements[`plot:${w.id}`]?.open === true);
  if (!shown.length) return null;
  const front = shown.reduce((a, b) => (b.z >= a.z ? b : a));
  const id = front.kind === "map" ? front.datasetId : (shown.find((w) => w.kind === "map" && w.datasetId === activeId)?.datasetId ?? null);
  return id && datasets.some((d) => d.id === id) ? id : null;
}
