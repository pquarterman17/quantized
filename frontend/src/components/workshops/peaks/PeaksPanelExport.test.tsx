// UX9-F: the Peaks window's own Export CSV / Copy (one click, was six steps
// through the Library), and its d (Å) column on a 2θ axis.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks } from "../../../lib/api/peaks";
import { saveBlob } from "../../../lib/download";
import type { DataStruct } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));
vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));

function scan(metadata: Record<string, unknown>): DataStruct {
  return { time: [28, 28.4, 28.8, 47, 47.3, 47.6], values: [[1], [9], [1], [1], [7], [1]], labels: ["I"], units: ["cps"], metadata };
}

function setup(metadata: Record<string, unknown>) {
  useApp.setState({
    datasets: [{ id: "d1", name: "Si film.xy", data: scan(metadata) }],
    activeId: "d1", xKey: null, yKeys: null, seriesOrder: null, peakOverlay: null,
    annotations: [], history: [], future: [], peaksOpen: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  vi.mocked(findPeaks).mockResolvedValue({
    peaks: [
      { center: 28.4421, height: 9, fwhm: 0.1, prominence: 8, localSNR: 30, area: null, bg: 1 },
      { center: 47.3023, height: 7, fwhm: 0.12, prominence: 6, localSNR: 20, area: null, bg: 1 },
    ],
    background: [],
  });
});

describe("PeaksPanel — Export CSV / Copy and the d column", () => {
  it("exports the detected table as CSV in one click, with Bragg d at the file's λ", async () => {
    setup({ x_column_long: "2Theta", x_column_unit: "deg", wavelength_a: 1.5406 });
    render(<PeaksPanel />);
    const table = await screen.findByRole("table", { name: "detected peaks" });
    // header carries d (Å) — λ came from the file, so no "assumed" note
    expect(within(table).getByText("d (Å)")).toBeInTheDocument();
    // Si (111): d = 1.5406 / (2·sin(14.22105°)) = 3.13559 Å
    expect(within(table).getAllByRole("row")[1].textContent).toContain("3.13559");

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = vi.mocked(saveBlob).mock.calls[0];
    expect(name).toBe("Si_film_detected_peaks.csv");
    const text = await (blob as Blob).text();
    const [header, first] = text.trim().split("\n");
    expect(header).toBe("peak,center,d_A,height,fwhm,snr");
    expect(Number(first.split(",")[2])).toBeCloseTo(3.13559, 4);
  });

  it("says when λ is assumed, and shows no d column off a 2θ axis", async () => {
    setup({ x_column_long: "2Theta", x_column_unit: "deg" });
    const { unmount } = render(<PeaksPanel />);
    const table = await screen.findByRole("table", { name: "detected peaks" });
    expect(within(table).getByText("d (Å, λ 1.5406)")).toBeInTheDocument();
    unmount();

    setup({ x_column_long: "Field", x_column_unit: "Oe" });
    render(<PeaksPanel />);
    const plain = await screen.findByRole("table", { name: "detected peaks" });
    expect(within(plain).queryByText(/^d \(Å/)).not.toBeInTheDocument();
  });

  it("Copy writes the same table as TSV to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup({ x_column_long: "2Theta", x_column_unit: "deg", wavelength_a: 1.5406 });
    render(<PeaksPanel />);
    await screen.findByRole("table", { name: "detected peaks" });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(useApp.getState().status).toBe("copied 2 detected peaks"));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0][0]).split("\n")[0]).toBe("peak\tcenter\td_A\theight\tfwhm\tsnr");
  });
});
