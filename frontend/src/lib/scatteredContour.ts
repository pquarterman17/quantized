// Plot > Contour from scattered XYZ: opt in to the Map tab for a dataset whose
// X, Y, Z points are NOT on a grid. The Map tab is never offered for such data
// on a guess (a hysteresis loop or a temperature sweep also has three columns
// and no grid); the user asks, picks the X, Y and Z columns in the Map toolbar,
// and the backend interpolates them onto a grid, labelled as interpolated.
// Lazy: reached only from the command.

import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import { is2DMap } from "./mapdata";

/** Mark the focused dataset as scattered XYZ and open its Map tab. */
export function contourFromScattered(): void {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds) {
    toast("open a dataset with X, Y and Z columns first", "danger");
    return;
  }
  if (is2DMap(ds.data)) {
    toast("this dataset is already a 2-D map", "ok");
    s.setStageTab("map");
    return;
  }
  if (ds.data.labels.length + 1 < 3 || ds.data.values.length < 4) {
    toast("a scattered contour needs three numeric columns (X, Y, Z) and at least 4 rows", "danger");
    return;
  }
  if (ds.data.metadata["scatteredXYZ"] !== true) {
    s.recordHistory("contour from scattered XYZ");
    const data = { ...ds.data, metadata: { ...ds.data.metadata, scatteredXYZ: true } };
    useApp.setState((st) => ({ datasets: st.datasets.map((d) => (d.id === ds.id ? { ...d, data } : d)) }));
  }
  s.setStageTab("map");
  toast("pick the X, Y and Z columns in the Map toolbar; the points are interpolated onto a grid", "ok");
}
