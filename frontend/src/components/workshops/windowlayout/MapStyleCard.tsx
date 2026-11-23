// The Style window's 2-D map card in windows mode (WORKSPACE_LAYOUT_PLAN P5, UX
// pass 4 M2): the same card the classic Map tab shows, bound to the dataset of
// the map window in use (lib/windowLayout/mapCard) and titled with its name, so
// with two maps open it says which one it edits. Lazy: the Inspector loads it
// only while the layout host is on.

import { mapCardDatasetId } from "../../../lib/windowLayout/mapCard";
import { useApp } from "../../../store/useApp";
import MapCard from "../../Inspector/MapCard";

export default function MapStyleCard() {
  const id = useApp((s) => mapCardDatasetId(s.plotWindows, s.datasets, s.activeId, s.windowLayout));
  const name = useApp((s) => (id === null ? undefined : s.datasets.find((d) => d.id === id)?.name));
  if (id === null || name === undefined) return null;
  return <MapCard datasetId={id} name={name} />;
}
