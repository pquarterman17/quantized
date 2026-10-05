import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MapPayload } from "../../lib/mapdataFetch";
import MapSectorWedge from "./MapSectorWedge";
import type { UseMapSectorWedgeState } from "./useMapSectorWedge";

const PAYLOAD: MapPayload = {
  xAxis: [-2, 0, 2], yAxis: [-2, 0, 2], zGrid: [[1, 1, 1], [1, 2, 1], [1, 1, 1]],
  xLabel: "Qx", xUnit: "Ang^-1", yLabel: "Qz", yUnit: "Ang^-1",
  zLabel: "Intensity", zUnit: "counts", zMin: 1, zMax: 2,
};

function wedge(mode: "off" | "sector"): UseMapSectorWedgeState {
  return {
    mode,
    setMode: vi.fn(),
    sector: { qMin: 0.5, qMax: 1.5, phiMin: 0, phiMax: 90 },
    hover: null,
    dragging: false,
    cursor: "default",
    onDown: vi.fn(), onMove: vi.fn(), onUp: vi.fn(), onLeave: vi.fn(),
    preview: null, previewAxis: "q", setPreviewAxis: vi.fn(),
    runRadial: vi.fn(), runAzimuthal: vi.fn(), busy: false,
  };
}

describe("MapSectorWedge tool ownership", () => {
  it("renders no handles or floating controls while the sector tool is off", () => {
    const { container } = render(<MapSectorWedge payload={PAYLOAD} w={400} h={400} wedge={wedge("off")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders its four handles and controls only while armed", () => {
    const { container } = render(<MapSectorWedge payload={PAYLOAD} w={400} h={400} wedge={wedge("sector")} />);
    expect(container.querySelectorAll('[data-roi-handle^="sector-"]')).toHaveLength(4);
    expect(container.querySelector(".qzk-roi-bar")).not.toBeNull();
  });

  it("keeps an outer-radius handle visible when only the sector arc intersects the viewport", () => {
    const state = wedge("sector");
    state.sector = { qMin: 0, qMax: Math.SQRT2 * 2, phiMin: 0, phiMax: 360 };
    const { container } = render(<MapSectorWedge payload={PAYLOAD} w={400} h={400} wedge={state} />);
    expect(container.querySelector('[data-roi-handle="sector-qMax"]')).not.toBeNull();
  });
});
