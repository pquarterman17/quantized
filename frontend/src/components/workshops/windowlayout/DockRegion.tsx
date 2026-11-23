// One dock slot's windows (WORKSPACE_LAYOUT_PLAN D3): several windows on an
// edge stack along it (left/right top to bottom, bottom left to right) and
// several in the centre share it side by side ("row") or as a grid ("Tile
// all"). Each window's length is its placement `share`; the splitters between
// neighbours move the boundary (layoutGeometry.resizeShares).

import { Fragment, useRef } from "react";

import type { Slot, WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { applyLayout } from "../../../store/windowLayoutActions";
import { gridColumns, resizeShares } from "./layoutGeometry";
import LayoutWindowFrame from "./LayoutWindowFrame";
import Splitter from "./Splitter";

export default function DockRegion({
  slot,
  refs,
  layout,
  titleOf,
}: {
  slot: Slot;
  refs: readonly WindowRef[];
  layout: WindowLayoutV1;
  titleOf: (ref: WindowRef) => string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const grid = slot === "centre" && layout.centre === "grid";
  // Left/right stack downwards; the bottom edge and a centre row run across.
  const axis: "x" | "y" = slot === "left" || slot === "right" ? "y" : "x";
  const length = () => {
    const box = boxRef.current?.getBoundingClientRect();
    return (axis === "x" ? box?.width : box?.height) ?? 0;
  };
  const cols = gridColumns(refs.length);

  return (
    <div
      ref={boxRef}
      className={`qzk-wl-region qzk-wl-${slot}${grid ? " grid" : ""}`}
      data-slot={slot}
      data-axis={axis}
      style={grid ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
    >
      {refs.map((ref, i) => (
        <Fragment key={ref}>
          {i > 0 && !grid && (
            <Splitter
              axis={axis}
              label={`Resize ${titleOf(refs[i - 1])} and ${titleOf(ref)}`}
              onCommit={(delta) => applyLayout((l) => resizeShares(l, slot, i - 1, delta, length()))}
            />
          )}
          <div className="qzk-wl-cell" style={grid ? undefined : { flex: `${layout.placements[ref]?.share ?? 1} 1 0` }}>
            <LayoutWindowFrame refId={ref} slot={slot} title={titleOf(ref)} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
