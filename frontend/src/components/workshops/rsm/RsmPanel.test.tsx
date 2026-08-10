// RsmPanel — component tests for RSM_CUTS_PLAN #23: a degenerate
// eps_parallel (near-symmetric reflection) must render the backend's
// reason, not a bare "—" that reads as "not computed yet".

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, RsmPeak, RsmStrainResponse } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import RsmPanel from "./RsmPanel";

const { analyzeRsmMock, rsmStrainMock } = vi.hoisted(() => ({
  analyzeRsmMock: vi.fn(),
  rsmStrainMock: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  analyzeRsm: analyzeRsmMock,
  rsmStrain: rsmStrainMock,
}));

const RSM: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [60, 30, 100, 0.0008, 4.827],
    [61, 30, 200, 0.00044, 4.64],
    [60, 31, 150, 0.0004, 4.1],
    [61, 31, 300, 0.00042, 3.8],
  ],
  labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
  units: ["deg", "deg", "cps", "Ang^-1", "Ang^-1"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
};

function peak(rank: number, cls: string, q: [number, number]): RsmPeak {
  return {
    rank,
    classification: cls,
    centre_angle: [30, 60],
    centre_Q: q,
    fwhm_angle: [0.1, 0.2],
    fwhm_Q: [0.01, 0.02],
    amplitude: 100,
    background: 1,
  };
}

const DEGENERATE_STRAIN: RsmStrainResponse = {
  eps_parallel: null,
  eps_perp: 0.0403,
  a_sub_parallel: 7854.14,
  a_sub_perp: 1.301681,
  a_film_parallel: 14205.42,
  a_film_perp: 1.354114,
  relaxation: null,
  warnings: [
    "eps_parallel: substrate/film reflection is symmetric or near-symmetric " +
      "(|Qx|/|Qz| below tan(0.1 deg) ~= 1.75e-03 for at least one peak) -- " +
      "in-plane strain is not measurable from this reflection. Use a " +
      "genuinely asymmetric reflection (substantial Qx) for eps_parallel.",
  ],
};

const NORMAL_STRAIN: RsmStrainResponse = {
  eps_parallel: 0.0417,
  eps_perp: -0.0044,
  a_sub_parallel: 125.66,
  a_sub_perp: 1.3963,
  a_film_parallel: 130.9,
  a_film_perp: 1.3901,
  relaxation: null,
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [{ id: "d1", name: "epytaxy_rsm.xrdml", data: RSM }], activeId: "d1" });
  analyzeRsmMock.mockResolvedValue({
    peaks: [
      peak(1, "substrate", [0.0008, 4.827]),
      peak(2, "film", [0.00044, 4.64]),
    ],
    n_peaks_found: 2,
    intensity_unit: "cps",
    used_q_space: true,
  });
});

async function findPeaksAndComputeStrain(): Promise<void> {
  render(<RsmPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Find peaks" }));
  await waitFor(() => expect(analyzeRsmMock).toHaveBeenCalled());
  const strainButton = await screen.findByRole("button", { name: "Compute strain →" });
  fireEvent.click(strainButton);
  await waitFor(() => expect(rsmStrainMock).toHaveBeenCalled());
}

describe("RsmPanel — degenerate eps_parallel (RSM_CUTS_PLAN #23)", () => {
  it("renders 'not measurable' (not a bare dash) with the reason as a hover title", async () => {
    rsmStrainMock.mockResolvedValue(DEGENERATE_STRAIN);
    await findPeaksAndComputeStrain();

    const value = await screen.findByText("not measurable");
    expect(value).toBeInTheDocument();
    // Detailed reason on hover — the same disabled-with-reason-via-title
    // idiom RSM_CUTS_PLAN item 7 established for the peak-cut buttons in
    // this panel, reused here rather than a second way of explaining it.
    expect(value).toHaveAttribute("title", expect.stringContaining("in-plane strain is not measurable from this reflection"));
    // eps_perp stays a real number — only the degenerate field is affected.
    expect(screen.getByText("4.030 %")).toBeInTheDocument();
  });

  it("does not over-trigger: a genuinely asymmetric reflection shows a real value and no title", async () => {
    rsmStrainMock.mockResolvedValue(NORMAL_STRAIN);
    await findPeaksAndComputeStrain();

    const value = await screen.findByText("4.170 %");
    expect(value).toBeInTheDocument();
    expect(value).not.toHaveAttribute("title");
    expect(screen.queryByText("not measurable")).not.toBeInTheDocument();
  });
});
