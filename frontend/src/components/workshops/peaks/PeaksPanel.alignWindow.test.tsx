// "Align to peak…" opened from the Peaks panel must mount as a sibling of the
// panel's frame. A floating tool window is `position: absolute`, so one nested
// in the docked Peaks panel was placed from that panel's corner: on a 1360 px
// viewport it opened with its left edge at x=1220, clipped off the right edge.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks } from "../../../lib/api/peaks";
import type { DataStruct } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn(), alignPeaks: vi.fn() }));

const DATA: DataStruct = { time: [0, 1, 2, 3, 4, 5], values: [[1], [5], [2], [6], [2], [1]], labels: ["I"], units: ["cps"], metadata: {} };

beforeEach(() => {
  usePendingOps.setState({ ops: [] });
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [{ center: 1, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 }], background: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "x.dat", data: DATA }],
    activeId: "d1", xKey: null, yKeys: null, seriesOrder: null, peakOverlay: null, annotations: [], history: [], future: [], peaksOpen: true, reports: [],
  });
});

describe("Align to peak window placement", () => {
  it("is not nested inside the Peaks panel frame, and sits inside a 1360 px viewport", async () => {
    window.innerWidth = 1360;
    render(<PeaksPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Align to peak/ }));
    const win = await screen.findByRole("dialog", { name: /Align to peak/ });
    expect(win.parentElement?.closest(".qzk-win")).toBeNull();
    expect(win.closest("[data-tool-window='peaks']")).toBeNull();
    const { x, width } = useApp.getState().toolWindowLayout["peaks-align"] ?? { x: 0, width: 460 };
    expect(x + width).toBeLessThanOrEqual(1360);
  });
});
