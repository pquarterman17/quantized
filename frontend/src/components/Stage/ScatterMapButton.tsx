import { runLazy } from "../../lib/runLazy";

/** Shown in the stage bar for a three-column (X, Y, Z) dataset the grid gate
 *  rejected: the Map tab is never guessed for such data, but the user can ask
 *  for the scattered-points interpolation (Plot > Contour from scattered XYZ). */
export default function ScatterMapButton() {
  return (
    <button
      type="button"
      className="qz-btn qz-ghost qz-sm"
      title="These X, Y, Z points do not form a regular grid. Interpolate them onto one and open the Map tab."
      onClick={() => void runLazy("Opening scattered map…", () => import("../../lib/scatteredContour")).then((m) => m.contourFromScattered())}
    >
      View as scattered map
    </button>
  );
}
