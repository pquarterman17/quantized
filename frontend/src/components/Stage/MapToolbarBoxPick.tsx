// The map toolbar's Box and Pick buttons for a map that is NOT on an RSM axis
// pair (MapToolbarCutTools carries the Box button itself on an RSM pair). The
// Pick button is shown for every map: where the extraction coordinates are not
// well defined the click is refused with the reason in the status line.

import { mapPickPoint } from "../../lib/glyphs";
import type { MapToolbarProps } from "./MapToolbar";

type Props = Pick<MapToolbarProps, "roiMode" | "onToggleRoi" | "pickMode" | "onTogglePick"> & {
  /** Show the Box button: the cut tools (which hold it) are not on screen. */
  showBox: boolean;
};

export default function MapToolbarBoxPick({ roiMode, onToggleRoi, pickMode, onTogglePick, showBox }: Props) {
  return (
    <>
      <span className="qzk-tool-sep" />
      {showBox && (
        <button
          aria-label="Integration box"
          aria-pressed={roiMode === "roi"}
          className={`qzk-tool-btn${roiMode === "roi" ? " active" : ""}`}
          title="Box — drag on the map to draw one; drag inside to move it, edges/corners to resize. On this map it previews the profile; Map analysis and Map operations can take its bounds"
          onClick={onToggleRoi}
        >
          ▣
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
