// The P2.1 end-to-end flow at the layer the user experiences: a dataset that
// carries a durable fitted-peak table, one click of "Use fitted peaks", and a
// Williamson-Hall fit over exactly the included peaks. Rendered through the
// real ReductionsPanel + the real store — only the HTTP wrapper is mocked.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { williamsonHall } from "../../../lib/api/reductions";
import type { MultiFitResult, PeakTable } from "../../../lib/peakTable";
import { peakDataFingerprint, peakTableFromFit, withPeakExcluded } from "../../../lib/peakTableFit";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import ReductionsPanel from "./ReductionsPanel";

vi.mock("../../../lib/api/reductions", () => ({
  williamsonHall: vi.fn(),
}));

const scan: DataStruct = {
  time: [10, 20, 30],
  values: [[1], [2], [3]],
  labels: ["Intensity"],
  units: ["cps"],
  metadata: { wavelength_a: 1.5406 },
};

const FIT: MultiFitResult = {
  peaks: ([[30.1, 0.2], [43.2, 0.25], [50.5, 0.3]] as const).map(([c, w], i) => ({
    center: c,
    fwhm: w,
    height: 100 - i,
    bg: 5,
    eta: null,
    area: 20,
    status: "fitted(global)",
    model: "Gaussian",
  })),
  bgCoeffs: [5, 0],
  R2: 0.99,
  rmse: 0.5,
  nPeaks: 3,
  model: "Gaussian",
};

function table(): PeakTable {
  return peakTableFromFit(FIT, {
    datasetId: "d1",
    datasetName: "film.xrdml",
    method: "simultaneous",
    bgDegree: 1,
    linkMode: "None",
    constrain: false,
    wavelengthA: 1.5406,
  });
}

function mount(peakTable?: PeakTable): void {
  useApp.setState({
    datasets: [{ id: "d1", name: "film.xrdml", data: scan, ...(peakTable ? { peakTable } : {}) }],
    activeId: "d1",
    reductionsOpen: true,
    reductionsMethod: "williamson-hall",
  });
  render(<ReductionsPanel />);
}

const fieldValue = (label: string): string =>
  (screen.getByLabelText(label) as HTMLInputElement).value;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(williamsonHall).mockResolvedValue({
    grain_size_nm: 42,
    microstrain: 0.001,
    r2: 0.98,
    plot_x: [],
    plot_y: [],
    fit_line: [0.001, 0.05],
  });
  useApp.setState({ datasets: [], activeId: null });
});

describe("Williamson-Hall — Use fitted peaks (P2.1)", () => {
  it("offers nothing to import when the active dataset has never been fit", () => {
    mount();
    expect(screen.queryByRole("button", { name: /Use fitted peaks/ })).not.toBeInTheDocument();
    expect(fieldValue("peak 1 2θ")).toBe("0");
  });

  it("one click fills the table from the fitted peaks instead of manual entry", () => {
    mount(table());
    fireEvent.click(screen.getByRole("button", { name: "Use fitted peaks (3)" }));
    expect(fieldValue("peak 1 2θ")).toBe("30.1");
    expect(fieldValue("peak 2 2θ")).toBe("43.2");
    expect(fieldValue("peak 3 2θ")).toBe("50.5");
    expect(fieldValue("peak 1 FWHM")).toBe("0.2");
    expect(screen.queryByLabelText("peak 4 2θ")).not.toBeInTheDocument();
  });

  it("adopts the wavelength the pattern was measured at", () => {
    mount(table());
    fireEvent.change(screen.getByLabelText("Wavelength (Å)"), { target: { value: "0.7093" } });
    expect(fieldValue("Wavelength (Å)")).toBe("0.7093");
    fireEvent.click(screen.getByRole("button", { name: "Use fitted peaks (3)" }));
    expect(fieldValue("Wavelength (Å)")).toBe("1.5406");
  });

  it("omits peaks excluded in the Peaks workshop, and says so", async () => {
    const t = table();
    mount(withPeakExcluded(t, t.peaks[1].id, true));
    expect(screen.getByText(/1 excluded in the Peaks workshop/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use fitted peaks (2)" }));
    expect(fieldValue("peak 1 2θ")).toBe("30.1");
    expect(fieldValue("peak 2 2θ")).toBe("50.5"); // the 43.2 peak is gone
    expect(screen.queryByLabelText("peak 3 2θ")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    await screen.findByText("Grain size");
    expect(williamsonHall).toHaveBeenCalledWith({
      two_theta_deg: [30.1, 50.5],
      fwhm_deg: [0.2, 0.3],
      wavelength_a: 1.5406,
      k_factor: 0.9,
      instrumental_broadening_deg: 0,
    });
  });

  it("names the provenance of the loaded rows", () => {
    const t = table();
    mount(withPeakExcluded(t, t.peaks[2].id, true));
    fireEvent.click(screen.getByRole("button", { name: "Use fitted peaks (2)" }));
    expect(
      screen.getByText("2 fitted peaks from film.xrdml · Gaussian (simultaneous) · 1 excluded"),
    ).toBeInTheDocument();
  });

  it("drops the provenance line the moment a row is edited by hand", () => {
    mount(table());
    fireEvent.click(screen.getByRole("button", { name: "Use fitted peaks (3)" }));
    expect(screen.getByText(/3 fitted peaks from film.xrdml/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("peak 1 2θ"), { target: { value: "31" } });
    expect(screen.queryByText(/fitted peaks from film.xrdml/)).not.toBeInTheDocument();
  });

  it("a dataset whose every peak is excluded offers no import at all", () => {
    let t = table();
    for (const p of t.peaks) t = withPeakExcluded(t, p.id, true);
    mount(t);
    expect(screen.queryByRole("button", { name: /Use fitted peaks/ })).not.toBeInTheDocument();
  });
});

describe("Williamson-Hall — a table that no longer describes the data (review round 2)", () => {
  const fittedOn = (data: DataStruct, over: Partial<Parameters<typeof peakTableFromFit>[1]> = {}): PeakTable =>
    peakTableFromFit(FIT, {
      datasetId: "d1",
      datasetName: "film.xrdml",
      method: "simultaneous",
      bgDegree: 1,
      linkMode: "None",
      constrain: false,
      wavelengthA: 1.5406,
      xLabel: "2Theta",
      xUnit: "deg",
      fingerprint: peakDataFingerprint(data),
      ...over,
    });

  it("loads normally while the fingerprint still matches the live data", () => {
    mount(fittedOn(scan));
    const btn = screen.getByRole("button", { name: "Use fitted peaks (3)" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(fieldValue("peak 1 2θ")).toBe("30.1");
  });

  it("disables the action, and says why, once the data moved under the fit", () => {
    // Fit on one pattern, then the store holds a DIFFERENT one — exactly what
    // an xOff correction or a re-measure leaves behind.
    mount(fittedOn({ ...scan, time: [10.5, 20.5, 30.5] }));
    const btn = screen.getByRole("button", { name: "Use fitted peaks (3)" });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/fitted before the data changed/)).toBeInTheDocument();
    fireEvent.click(btn);
    expect(fieldValue("peak 1 2θ")).toBe("0"); // nothing loaded
  });

  it("refuses a table fit on a q axis, which `0 < 2θ < 180` would have waved through", () => {
    mount(fittedOn(scan, { xLabel: "q", xUnit: "1/A" }));
    expect(screen.getByRole("button", { name: "Use fitted peaks (3)" })).toBeDisabled();
    expect(screen.getByText(/not 2θ in degrees/)).toBeInTheDocument();
  });

  it("still loads a table whose x unit the file never recorded", () => {
    mount(fittedOn(scan, { xLabel: "", xUnit: "" }));
    fireEvent.click(screen.getByRole("button", { name: "Use fitted peaks (3)" }));
    expect(fieldValue("peak 1 2θ")).toBe("30.1");
  });
});

describe("Williamson-Hall — the previous result never outlives its inputs (review round 2)", () => {
  it("clears the result when one click swaps every input", async () => {
    mount(table());
    // A hand-entered fit first: two rows, a real result on screen.
    fireEvent.change(screen.getByLabelText("peak 1 2θ"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("peak 1 FWHM"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("peak 2 2θ"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("peak 2 FWHM"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    await screen.findByText("Grain size");
    expect(screen.getByText(/^42\b.*nm$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use fitted peaks (3)" }));

    // Without setResult(null) the old number stayed on screen directly under
    // the NEW provenance caption — a result captioned by inputs it was not
    // computed from.
    expect(screen.queryByText(/^42\b.*nm$/)).not.toBeInTheDocument();
    expect(screen.queryByText("Grain size")).not.toBeInTheDocument();
    expect(screen.getByText(/3 fitted peaks from film.xrdml/)).toBeInTheDocument();
    expect(williamsonHall).toHaveBeenCalledTimes(1);
  });

  it("a hand-typed wavelength drops the provenance line, like every other hand edit", () => {
    mount(table());
    fireEvent.click(screen.getByRole("button", { name: "Use fitted peaks (3)" }));
    expect(screen.getByText(/3 fitted peaks from film.xrdml/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Wavelength (Å)"), { target: { value: "0.7093" } });
    expect(screen.queryByText(/fitted peaks from film.xrdml/)).not.toBeInTheDocument();
    expect(fieldValue("Wavelength (Å)")).toBe("0.7093");
  });
});
