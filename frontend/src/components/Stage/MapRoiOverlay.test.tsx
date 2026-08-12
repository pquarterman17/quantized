// The ROI/ruler commit bar's remove affordance.
//
// Until this button existed, Delete/Backspace on a FOCUSED map was the only
// way to remove a box — and the map is only focusable once a shape exists, so
// with focus anywhere else (a Library row, say) the keystroke fell through to
// the global shortcut and removed the DATASET instead. Reported from a real
// session. The keystroke still works; this is the path that does not depend
// on where focus happens to be.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MapPayload } from "../../lib/mapdata";
import type { RoiRect, RoiRuler } from "../../lib/roi";
import MapRoiOverlay, { type MapRoiOverlayProps } from "./MapRoiOverlay";
import type { UseMapRulerState } from "./useMapRuler";
import type { UseMapSectorWedgeState } from "./useMapSectorWedge";

// The wedge is its own component with its own gesture hook; this file is
// about the commit bar, so it is stubbed rather than wired.
vi.mock("./MapSectorWedge", () => ({ default: () => null }));

const PAYLOAD: MapPayload = {
  xAxis: [0, 1, 2],
  yAxis: [0, 1, 2],
  zGrid: [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ],
  xLabel: "Qx",
  xUnit: "1/Å",
  yLabel: "Qz",
  yUnit: "1/Å",
  zLabel: "Intensity",
  zUnit: "counts",
  zMin: 1,
  zMax: 9,
};

const RECT: RoiRect = { space: "q", x0: 0.2, x1: 1.8, y0: 0.2, y1: 1.8 };
const RULER: RoiRuler = { space: "q", cx: 1, cy: 1, angle: 30, length: 1, width: 0.2 };

function rulerState(overrides: Partial<UseMapRulerState> = {}): UseMapRulerState {
  return {
    mode: "off", setMode: vi.fn(), ruler: null, hover: null, dragging: false, cursor: "default",
    onDown: vi.fn(), onMove: vi.fn(), onUp: vi.fn(), onLeave: vi.fn(), onKeyDown: vi.fn(),
    remove: vi.fn(),
    preview: null, previewAxis: "x", setPreviewAxis: vi.fn(), previewStats: null,
    commitIntegrate: vi.fn(), landingBusy: false, commitStats: vi.fn(), statsBusy: false,
    apiStats: null, statsError: null, clearStats: vi.fn(),
    ...overrides,
  } as UseMapRulerState;
}

function renderOverlay(overrides: Partial<MapRoiOverlayProps> = {}) {
  const onRemove = vi.fn();
  const props: MapRoiOverlayProps = {
    payload: PAYLOAD, w: 400, h: 300, rect: RECT,
    preview: null, previewAxis: "x", onPreviewAxisChange: vi.fn(), previewStats: null,
    onIntegrate: vi.fn(), landingBusy: false, onStats: vi.fn(), statsBusy: false,
    apiStats: null, statsError: null, onClearStats: vi.fn(), onRemove, dragging: false,
    rulerState: rulerState(),
    wedgeState: {} as UseMapSectorWedgeState,
    ...overrides,
  };
  render(<MapRoiOverlay {...props} />);
  return { onRemove, props };
}

describe("MapRoiOverlay remove affordance", () => {
  it("removes the box from its own bar, with no keyboard focus involved", () => {
    const { onRemove } = renderOverlay();
    fireEvent.click(screen.getByLabelText("Remove this box"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("gives the ruler its own remove, not the box's", () => {
    const rulerRemove = vi.fn();
    const { onRemove } = renderOverlay({
      rect: null,
      rulerState: rulerState({ ruler: RULER, remove: rulerRemove }),
    });
    fireEvent.click(screen.getByLabelText("Remove this ruler"));
    expect(rulerRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("labels the two removes distinctly when both shapes are on the map", () => {
    // Both bars render at once; an ambiguous label would make the wrong one
    // reachable by name for a screen-reader user.
    renderOverlay({ rulerState: rulerState({ ruler: RULER }) });
    expect(screen.getByLabelText("Remove this box")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove this ruler")).toBeInTheDocument();
  });

  it("keeps remove out of the commit button row, so it is not mis-hit", () => {
    // The ∫/Stats row is what the user is aiming at repeatedly; a destructive
    // control sharing it invites exactly the mis-hit this fix is about.
    renderOverlay();
    const remove = screen.getByLabelText("Remove this box");
    const commitRow = screen.getByRole("button", { name: "∫x" }).parentElement;
    expect(commitRow).not.toContainElement(remove);
  });

  it("renders no bar at all when nothing is drawn", () => {
    renderOverlay({ rect: null });
    expect(screen.queryByLabelText("Remove this box")).not.toBeInTheDocument();
  });
});

// The bar appears at the drag ORIGIN the instant a zero-size box exists, i.e.
// under the cursor. A canvas cannot have DOM children, so the pointer crossing
// onto this sibling div fires the canvas's onMouseLeave → cancelDrag → the
// shape reverts. Measured in the running app: drawing from (560, 390) put the
// bar at x 560..776, y 398..518, straight across the drag path, so the box
// vanished mid-drag. Reported as "resizing the integration box did not work".
describe("MapRoiOverlay does not eat its own drag", () => {
  const barOf = (label: string) => screen.getByLabelText(label).closest(".qzk-roi-bar");

  it("is pointer-transparent while the box is being dragged", () => {
    renderOverlay({ dragging: true });
    expect(barOf("Remove this box")).toHaveStyle({ pointerEvents: "none" });
  });

  it("is interactive again once the drag ends", () => {
    renderOverlay({ dragging: false });
    expect(barOf("Remove this box")).not.toHaveStyle({ pointerEvents: "none" });
  });

  it("applies the same rule to the ruler's own bar, driven by the RULER's drag", () => {
    // The two shapes drag independently; the box's flag must not silence the
    // ruler's bar or vice versa.
    renderOverlay({ dragging: false, rulerState: rulerState({ ruler: RULER, dragging: true }) });
    expect(barOf("Remove this ruler")).toHaveStyle({ pointerEvents: "none" });
    expect(barOf("Remove this box")).not.toHaveStyle({ pointerEvents: "none" });
  });
});
