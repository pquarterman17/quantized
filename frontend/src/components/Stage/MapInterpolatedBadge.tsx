// A small label on the Map tab when the points were not on a grid and the
// picture is an interpolation of them (never present raw scatter as a measured
// grid). Rendered from the backend's `interpolated` flag.

import { interpolatedNote } from "../../lib/mapdataFetch";

interface Props {
  nPoints: number;
}

export default function MapInterpolatedBadge({ nPoints }: Props) {
  return (
    <div
      className="qzk-glass qzk-ds-meta"
      role="note"
      data-map-interpolated=""
      style={{ position: "absolute", left: 12, bottom: 12, padding: "2px 8px", pointerEvents: "none" }}
    >
      {interpolatedNote(nPoints)}
    </div>
  );
}
