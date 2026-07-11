import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi } from "../../lib/api";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import CorrectionsCard from "./CorrectionsCard";

vi.mock("../../lib/api", () => ({ applyCorrections: vi.fn(), uploadFile: vi.fn() }));

const sample: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["M"],
  units: ["emu"],
  metadata: {},
};
const bg: DataStruct = { ...sample, values: [[1], [1], [1]] };

const d1: Dataset = { id: "d1", name: "scan.dat", data: sample };
const bgDs: Dataset = { id: "bg1", name: "bg.dat", data: bg };

/** The native <select> that owns the <option> with the given visible text. */
function selectOwning(optionText: string): HTMLSelectElement {
  const sel = screen.getByRole("option", { name: optionText }).closest("select");
  if (!sel) throw new Error(`no <select> owns option "${optionText}"`);
  return sel as HTMLSelectElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...sample, values: [[9], [19], [29]] });
  useApp.setState({ datasets: [d1, bgDs], activeId: "d1", status: "" });
});

describe("CorrectionsCard background picker", () => {
  it("offers other loaded datasets as a reference background", () => {
    render(<CorrectionsCard active={d1} />);
    // The active dataset is excluded; the other one + "none" are offered.
    expect(screen.getByRole("option", { name: "— none —" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "bg.dat" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "scan.dat" })).not.toBeInTheDocument();
  });

  it("forwards the picked background + interp through to the API", async () => {
    render(<CorrectionsCard active={d1} />);

    fireEvent.change(selectOwning("bg.dat"), { target: { value: "bg1" } });
    // The interp select only appears once a background is chosen.
    fireEvent.change(selectOwning("pchip"), { target: { value: "pchip" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(applyCorrectionsApi).toHaveBeenCalledWith({
        dataset: sample,
        params: {},
        bg_dataset: bg,
        bg_interp: "pchip",
      }),
    );
  });

  it("sends no background when left at none", async () => {
    render(<CorrectionsCard active={d1} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(applyCorrectionsApi).toHaveBeenCalled());
    expect(applyCorrectionsApi).toHaveBeenCalledWith({ dataset: sample, params: {} });
  });

  it("hides the picker entirely when no other dataset is loaded", () => {
    useApp.setState({ datasets: [d1], activeId: "d1" });
    render(<CorrectionsCard active={d1} />);
    expect(screen.queryByRole("option", { name: "— none —" })).not.toBeInTheDocument();
  });
});

describe("CorrectionsCard beam footprint (GOTO #7b)", () => {
  it("hides the geometry fields until the footprint checkbox is on", () => {
    render(<CorrectionsCard active={d1} />);
    expect(screen.queryByText("Beam w")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Footprint (XRR/NR)"));
    expect(screen.getByText("Beam w")).toBeInTheDocument();
    expect(screen.getByText("Sample L")).toBeInTheDocument();
  });

  it("ships footprintW/L (+ 2θ flag) only when enabled and complete", async () => {
    render(<CorrectionsCard active={d1} />);
    fireEvent.click(screen.getByLabelText("Footprint (XRR/NR)"));
    const [wField, lField] = screen.getAllByPlaceholderText("mm");
    fireEvent.change(wField, { target: { value: "0.2" } });
    fireEvent.change(lField, { target: { value: "10" } });
    fireEvent.click(screen.getByLabelText("X axis is 2θ"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(applyCorrectionsApi).toHaveBeenCalledWith({
        dataset: sample,
        params: { footprintW: 0.2, footprintL: 10, footprintTwoTheta: true },
      }),
    );
  });

  it("omits the footprint params when the geometry is incomplete", async () => {
    render(<CorrectionsCard active={d1} />);
    fireEvent.click(screen.getByLabelText("Footprint (XRR/NR)"));
    const [wField] = screen.getAllByPlaceholderText("mm");
    fireEvent.change(wField, { target: { value: "0.2" } }); // no sample length
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(applyCorrectionsApi).toHaveBeenCalled());
    expect(applyCorrectionsApi).toHaveBeenCalledWith({ dataset: sample, params: {} });
  });
});
