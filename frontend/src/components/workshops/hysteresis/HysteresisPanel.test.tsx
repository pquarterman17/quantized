// HysteresisPanel — the parameter table names each value's unit (round-3 plot
// audit: "Hc (mean) 721.321" on a VSM loop gave no hint it was oersteds).
// Uses the REAL useApp/useHysteresis stores, the MagToolsPanel.test.tsx pattern.

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hysteresisAnalysis } from "../../../lib/api/magnetometry";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import HysteresisPanel from "./HysteresisPanel";

vi.mock("../../../lib/api/magnetometry", () => ({
  hysteresisAnalysis: vi.fn(),
  subtractHysteresisBackground: vi.fn(),
}));

const LOOP: DataStruct = {
  time: [-15000, 0, 15000],
  values: [[-1], [0], [1]],
  labels: ["Moment"],
  units: ["emu"],
  metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hysteresisAnalysis).mockResolvedValue({
    HcMean: 721.3,
    MrMean: 7.5e-5,
    MsMean: 2e-3,
    squareness: 0.04,
    loopArea: 0.97,
    SFD: { peakH: 2446, fwhm: 390 },
    warnings: [],
  });
  useApp.setState({
    datasets: [{ id: "d1", name: "vsm.dat", data: LOOP }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
  });
});

describe("HysteresisPanel — units", () => {
  it("shows the field unit beside Hc/SFD and the moment unit beside Mr/Ms", async () => {
    render(<HysteresisPanel />);
    const hc = (await screen.findByText("Hc (mean)")).closest("tr") as HTMLElement;
    expect(within(hc).getByText("Oe")).toBeInTheDocument();
    const ms = screen.getByText("Ms (mean)").closest("tr") as HTMLElement;
    expect(within(ms).getByText("emu")).toBeInTheDocument();
    const area = screen.getByText("Loop area").closest("tr") as HTMLElement;
    expect(within(area).getByText("Oe·emu")).toBeInTheDocument();
    const fwhm = screen.getByText("SFD FWHM").closest("tr") as HTMLElement;
    expect(within(fwhm).getByText("Oe")).toBeInTheDocument();
  });
});
