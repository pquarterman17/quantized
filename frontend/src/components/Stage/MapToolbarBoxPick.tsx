// The map toolbar's Box and Pick buttons for a map that is NOT on an RSM axis
// pair (MapToolbarCutTools carries the Box button itself on an RSM pair). The
// Pick button is shown for every map: where the extraction coordinates are not
// well defined the click is refused with the reason in the status line.

import { mapPickPoint, mapPolygonRoi } from "../../lib/glyphs";
import type { MapToolbarProps } from "./MapToolbar";

type Props = Pick<MapToolbarProps, "roiMode" | "onToggleRoi" | "pickMode" | "onTogglePick" | "polygonMode" | "onTogglePolygon"> & {
  /** Show the Polygon button: the map can be drawn on. */
  showPolygon: boolean;
  /** Show the Box button: the cut tools (which hold it) are not on screen. */
  showBox: boolean;
};

export default function MapToolbarBoxPick({ roiMode, onToggleRoi, pickMode, onTogglePick, polygonMode, onTogglePolygon, showPolygon, showBox }: Props) {
  return (
    <>
      <span className="qzk-tool-sep" />
      {showBox && (
        <button
          aria-label="Integration box"
          aria-pressed={roiMode === "roi"}
          className={`qzk-tool-btn${roiMode === "roi" ? " active" : ""}`}
          title="Box — drag on the map to draw one; drag inside to move it, edges or corners to resize; Map analysis and Map operations can take its bounds"
          onClick={onToggleRoi}
        >
          ▣
        </button>
      )}
      {showPolygon && (
        <button
          aria-label="Polygon ROI"
          aria-pressed={polygonMode === "polygon"}
          className={`qzk-tool-btn${polygonMode === "polygon" ? " active" : ""}`}
          title="Polygon: click to add vertices, double-click or Enter closes it, Backspace removes the last, Esc abandons it, drag a vertex to move it"
          onClick={onTogglePolygon}
        >
          {mapPolygonRoi}
        </button>
      )}
      <button
        aria-label="Pick point"
        aria-pressed={pickMode === "pick"}
        className={`qzk-tool-btn${pickMode === "pick" ? " active" : ""}`}
        title="Pick point — click the map to fill the location of Map gridding's pixel extraction (the view must show the maps' own axes)"
        onClick={onTogglePick}
      >
        {mapPickPoint}
      </button>
    </>
  );
}
