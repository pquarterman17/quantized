// OpticalGapPanel — unit/scale detection, the transmittance guard, the Tauc
// request, the result readout and the plot payload. The backend is mocked.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaucResult } from "../../../lib/api/analysisExtras";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import OpticalGapPanel from "./OpticalGapPanel";
import { guessSignal, guessXUnit } from "./useOpticalGap";
import { taucPayload } from "./taucPlot";

const { taucMock } = vi.hoisted(() => ({ taucMock: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({ taucFit: taucMock }));
vi.mock("../SmallUPlot", () => ({ default: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }));

const EV: DataStruct = {
  time: [2, 2.5, 3, 3.5],
  values: [[1e3], [1e4], [5e4], [9e4]],
  labels: ["alpha"],
  units: ["1/cm"],
  metadata: { x_column_name: "Energy", x_column_unit: "eV" },
};
const NM: DataStruct = {
  time: [700, 600, 500, 400],
  values: [[98], [90], [50], [5]],
  labels: ["T"],
  units: ["%"],
  metadata: { x_column_name: "Wavelength", x_column_unit: "nm" },
};

const RESULT: TaucResult = {
  kind: "direct", label: "Direct allowed", gamma: 2, eg: 2.35, eg_se: 0.01, eg_se_fit: 0.01, eg_window_sd: null, eg_lcl: 2.32, eg_ucl: 2.38, level: 0.95,
  slope: 100, intercept: -235, r2: 0.999, n_fit: 5, e_min: 2.6, e_max: 3.2, auto_window: false,
  energy: [2, 2.6, 3, 3.2], tauc: [0, 25, 65, 85], alpha: [0, 1, 2, 3], fit_energy: [2.35, 3.2], fit_tauc: [0, 85],
};

beforeEach(() => {
  vi.clearAllMocks();
  taucMock.mockResolvedValue(RESULT);
  useApp.setState({ datasets: [{ id: "a", name: "abs", data: EV }, { id: "t", name: "trans", data: NM }], activeId: "a", status: "" });
});

describe("OpticalGapPanel", () => {
  it("fits an eV absorption spectrum with the chosen transition and window", async () => {
    render(<OpticalGapPanel />);
    await waitFor(() => expect(screen.getByLabelText("X quantity")).toHaveValue("eV"));
    fireEvent.change(screen.getByLabelText("Transition type"), { target: { value: "indirect" } });
    fireEvent.change(screen.getByLabelText("Fit range minimum (eV)"), { target: { value: "2.6" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    expect(await screen.findByText(/Eg = 2\.35 ± 0\.01 eV/)).toBeInTheDocument();
    expect(taucMock).toHaveBeenCalledWith(expect.objectContaining({
      x: EV.time, y: [1e3, 1e4, 5e4, 9e4], x_unit: "eV", signal: "alpha", kind: "indirect", e_min: 2.6,
    }));
    expect(screen.getByRole("img", { name: /Tauc plot/ })).toBeInTheDocument();
  });

  it("detects nm and percent transmittance and requires a thickness", async () => {
    useApp.setState({ activeId: "t" });
    render(<OpticalGapPanel />);
    await waitFor(() => expect(screen.getByLabelText("X quantity")).toHaveValue("nm"));
    expect(screen.getByLabelText("Y quantity")).toHaveValue("transmittance");
    expect(screen.getByLabelText("Transmittance scale")).toHaveValue("percent");
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the film thickness");
    expect(taucMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Film thickness (nm)"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    await screen.findByText(/Eg = /);
    expect(taucMock).toHaveBeenCalledWith(expect.objectContaining({ x_unit: "nm", signal: "transmittance", percent: true, thickness_nm: 300 }));
  });

  it("surfaces a backend error and warns about a poor line", async () => {
    taucMock.mockRejectedValueOnce(new Error("the fit window has no rising edge"));
    render(<OpticalGapPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no rising edge");
    taucMock.mockResolvedValueOnce({ ...RESULT, r2: 0.9 });
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    expect(await screen.findByText(/fits the window poorly/)).toBeInTheDocument();
  });

  it("adds the Tauc data sorted by energy", async () => {
    render(<OpticalGapPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Tauc data as dataset" }));
    const added = useApp.getState().datasets.find((d) => d.name.startsWith("abs (Tauc"))!;
    expect(added.data.time).toEqual([2, 2.6, 3, 3.2]);
    expect(added.data.values[1]).toEqual([1, 25]);
  });
});

describe("OpticalGapPanel inputs", () => {
  it("re-reads the signal when another Y column is picked and drops rows with missing values", async () => {
    const two: DataStruct = {
      time: [2, 2.5, 3, 3.5],
      values: [[1e3, 90], [1e4, Number.NaN], [5e4, 50], [9e4, 5]],
      labels: ["alpha", "T"],
      units: ["1/cm", "%"],
      metadata: { x_column_name: "Energy", x_column_unit: "eV" },
    };
    useApp.setState({ datasets: [{ id: "two", name: "two", data: two }], activeId: "two" });
    render(<OpticalGapPanel />);
    await waitFor(() => expect(screen.getByLabelText("Y quantity")).toHaveValue("alpha"));
    fireEvent.change(screen.getByLabelText("Y column"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByLabelText("Y quantity")).toHaveValue("transmittance"));
    expect(screen.getByLabelText("Transmittance scale")).toHaveValue("percent");
    fireEvent.change(screen.getByLabelText("Film thickness (nm)"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    await screen.findByText(/Eg = /);
    // The NaN row never reaches the request (a JSON null is a 422 on the server).
    expect(taucMock).toHaveBeenCalledWith(expect.objectContaining({ x: [2, 3, 3.5], y: [90, 50, 5] }));
  });
});

describe("unit and signal guesses", () => {
  it("reads meV, wavenumber, angstrom and micron axes", () => {
    expect(guessXUnit("meV", [1])).toBe("meV");
    expect(guessXUnit("eV", [1])).toBe("eV");
    expect(guessXUnit("cm⁻¹", [1])).toBe("cm-1");
    expect(guessXUnit("cm^-1", [1])).toBe("cm-1");
    expect(guessXUnit("1/cm", [1])).toBe("cm-1");
    expect(guessXUnit("nm", [1])).toBe("nm");
    expect(guessXUnit("Å", [1])).toBe("A");
    expect(guessXUnit("µm", [1])).toBe("um");
    expect(guessXUnit("", [400, 700])).toBe("nm");
    expect(guessXUnit("", [1.5, 3.5])).toBe("eV");
  });

  it("keeps reflectance out of transmittance and gives absorbance its own mode", () => {
    expect(guessSignal("Reflectance", "%", [5, 40])).toEqual({ signal: "alpha", percent: false });
    expect(guessSignal("Absorbance", "", [0.1, 2])).toEqual({ signal: "absorbance", percent: false });
    expect(guessSignal("A", "", [0.1, 2])).toEqual({ signal: "absorbance", percent: false });
    expect(guessSignal("alpha", "1/cm", [1e3, 1e5])).toEqual({ signal: "alpha", percent: false });
  });
});

describe("absorbance without a thickness", () => {
  it("claims no unit for alpha in the added dataset and keeps the interval in metadata", async () => {
    const abs: DataStruct = { time: [2, 2.5, 3, 3.5], values: [[0.1], [0.2], [0.5], [0.9]], labels: ["Absorbance"], units: [""], metadata: { x_column_name: "Energy", x_column_unit: "eV" } };
    useApp.setState({ datasets: [{ id: "ab", name: "abs", data: abs }], activeId: "ab" });
    render(<OpticalGapPanel />);
    await waitFor(() => expect(screen.getByLabelText("Y quantity")).toHaveValue("absorbance"));
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Tauc data as dataset" }));
    expect(taucMock).toHaveBeenCalledWith(expect.objectContaining({ signal: "absorbance", thickness_nm: undefined }));
    const added = useApp.getState().datasets.find((d) => d.name.startsWith("abs (Tauc"))!;
    expect(added.data.labels[0]).toBe("α (∝ A)");
    expect(added.data.units[0]).toBe("");
    expect(added.data.metadata["tauc"]).toMatchObject({ eg_low: 2.32, eg_high: 2.38, ci_level: 0.95, auto_window: false });
  });

  it("explains that the auto-window interval includes the window choice", async () => {
    taucMock.mockResolvedValueOnce({ ...RESULT, auto_window: true, eg_se: 0.03, eg_se_fit: 0.01, eg_window_sd: 0.028 });
    render(<OpticalGapPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    expect(await screen.findByText(/include how far Eg moves between neighbouring windows/)).toBeInTheDocument();
    expect(screen.getByText("spread over neighbouring windows (eV)")).toBeInTheDocument();
  });
});

describe("guessSignal", () => {
  it("does not throw on a very large column", () => {
    const big = Array.from({ length: 400_000 }, (_, i) => i % 100);
    expect(guessSignal("T", "%", big)).toEqual({ signal: "transmittance", percent: true });
  });

  it("reads the column name and unit, never the value range", () => {
    // Absorption coefficients that happen to sit under 100 stay absorption.
    expect(guessSignal("alpha", "1/cm", [0, 97])).toEqual({ signal: "alpha", percent: false });
    expect(guessSignal("Column 2", "", [0, 50])).toEqual({ signal: "alpha", percent: false });
    expect(guessSignal("T", "%", [5, 98])).toEqual({ signal: "transmittance", percent: true });
    expect(guessSignal("Transmittance", "", [0.1, 0.9])).toEqual({ signal: "transmittance", percent: false });
    expect(guessSignal("Transmission", "", [10, 90])).toEqual({ signal: "transmittance", percent: true });
  });
});

describe("taucPayload", () => {
  it("draws the line from the intercept on an ascending x column", () => {
    const p = taucPayload(RESULT, "(αhν)^2");
    const [x, pts, line] = p.data as [number[], (number | null)[], (number | null)[]];
    expect([...x]).toEqual([...x].sort((a, b) => a - b));
    const at = x.indexOf(2.35);
    expect(pts[at]).toBeNull();
    expect(line[at]).toBeCloseTo(0, 9);
    expect(line[x.indexOf(3.2)]).toBeCloseTo(85, 9);
    expect(line[x.indexOf(2)]).toBeNull(); // below the intercept, no line
  });
});
