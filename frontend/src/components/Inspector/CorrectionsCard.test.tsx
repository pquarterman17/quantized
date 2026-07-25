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

describe("CorrectionsCard rescaling (MAIN #37)", () => {
  /** The number input sitting next to a given ×/÷ operator select. */
  function scaleInput(label: "X scale" | "Y scale"): HTMLInputElement {
    const row = screen.getByText(label).closest(".qz-meta-row");
    if (!row) throw new Error(`no row for ${label}`);
    const input = row.querySelector("input");
    if (!input) throw new Error(`no input in the ${label} row`);
    return input as HTMLInputElement;
  }
  function opSelect(label: "X scale" | "Y scale"): HTMLSelectElement {
    const row = screen.getByText(label).closest(".qz-meta-row");
    const sel = row?.querySelector("select");
    if (!sel) throw new Error(`no operator select in the ${label} row`);
    return sel as HTMLSelectElement;
  }
  const apply = () => fireEvent.click(screen.getByRole("button", { name: "Apply" }));

  it("sends a multiply straight through as the stored multiplier", async () => {
    render(<CorrectionsCard active={d1} />);
    fireEvent.change(scaleInput("Y scale"), { target: { value: "1000" } });
    apply();
    await waitFor(() => expect(applyCorrectionsApi).toHaveBeenCalled());
    const { params } = vi.mocked(applyCorrectionsApi).mock.calls[0][0];
    expect(params.yScale).toBe(1000);
  });

  it("stores a division as its reciprocal", async () => {
    render(<CorrectionsCard active={d1} />);
    fireEvent.change(opSelect("X scale"), { target: { value: "÷" } });
    fireEvent.change(scaleInput("X scale"), { target: { value: "10" } });
    apply();
    await waitFor(() => expect(applyCorrectionsApi).toHaveBeenCalled());
    expect(vi.mocked(applyCorrectionsApi).mock.calls[0][0].params.xScale).toBe(0.1);
  });

  it("omits the scale entirely when the field is blank", async () => {
    render(<CorrectionsCard active={d1} />);
    apply();
    await waitFor(() => expect(applyCorrectionsApi).toHaveBeenCalled());
    const { params } = vi.mocked(applyCorrectionsApi).mock.calls[0][0];
    expect(params.xScale).toBeUndefined();
    expect(params.yScale).toBeUndefined();
  });

  it("blocks Apply and says why on a zero factor", () => {
    render(<CorrectionsCard active={d1} />);
    fireEvent.change(opSelect("Y scale"), { target: { value: "÷" } });
    fireEvent.change(scaleInput("Y scale"), { target: { value: "0" } });
    expect(screen.getByRole("alert")).toHaveTextContent("cannot divide by zero");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("blocks Apply on non-numeric text", () => {
    render(<CorrectionsCard active={d1} />);
    fireEvent.change(scaleInput("X scale"), { target: { value: "abc" } });
    expect(screen.getByRole("alert")).toHaveTextContent("must be a finite number");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("re-enables Apply once the bad factor is cleared", () => {
    render(<CorrectionsCard active={d1} />);
    const input = scaleInput("X scale");
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("re-opens a stored multiplier verbatim, as × (documented round-trip)", () => {
    // "÷ 10" was stored as 0.1; the multiplier IS the stored truth, so it
    // comes back as "× 0.1" rather than resurrecting a second field.
    const scaled: Dataset = { ...d1, corrections: { xScale: 0.1 } };
    useApp.setState({ datasets: [scaled, bgDs], activeId: "d1" });
    render(<CorrectionsCard active={scaled} />);
    expect(scaleInput("X scale").value).toBe("0.1");
    expect(opSelect("X scale").value).toBe("×");
  });
});
