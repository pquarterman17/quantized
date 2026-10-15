// MagToolsPanel — DOM-level cover for BUG-021 defect 4 (the labelling) and for
// the fail-closed behaviour of defect 3, at the layer the user experiences.
// "High-T fraction" and "Fits a line to the high-T tail of M(T)" were shown
// over an M(H) loop, which is how the wrong analysis went unnoticed.
// Uses the REAL useApp/useMagTools stores, the BaselinePanel.test.tsx pattern.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { subtractHysteresisBackground, subtractMagBackground } from "../../../lib/api/magnetometry";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import MagToolsPanel from "./MagToolsPanel";

vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(),
  subtractHysteresisBackground: vi.fn(),
  convertMagUnits: vi.fn(),
  demagCorrectField: vi.fn(),
}));

function load(name: string, xName: string, xUnit: string): void {
  const data: DataStruct = {
    time: [-15000, 0, 15000],
    values: [[-1], [0], [1]],
    labels: ["Moment"],
    units: ["emu"],
    metadata: { x_column_name: xName, x_column_unit: xUnit },
  };
  useApp.setState({
    datasets: [{ id: "d1", name, data }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    status: "",
  });
}

const subtractButton = (): HTMLButtonElement =>
  screen.getByRole("button", { name: /Subtract background/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MagToolsPanel — Background tab labelling follows the selected path", () => {
  it("an M(H) loop shows the FIELD wording, not the high-T wording", () => {
    load("loop.dat", "Magnetic Field", "Oe");
    render(<MagToolsPanel />);

    expect(screen.getByText(/High-field fraction/)).toBeInTheDocument();
    expect(screen.queryByText(/High-T fraction/)).not.toBeInTheDocument();
    expect(screen.getByText(/both saturated tails/)).toBeInTheDocument();
    expect(screen.queryByText(/high-T tail of M\(T\)/)).not.toBeInTheDocument();
    expect(subtractButton()).toBeEnabled();
  });

  it("an M(T) curve keeps the high-T wording", () => {
    load("mt.dat", "Temperature", "K");
    render(<MagToolsPanel />);

    expect(screen.getByText(/High-T fraction/)).toBeInTheDocument();
    expect(screen.queryByText(/High-field fraction/)).not.toBeInTheDocument();
    expect(screen.getByText(/high-T tail of M\(T\)/)).toBeInTheDocument();
    expect(subtractButton()).toBeEnabled();
  });

  it("each path shows its OWN default fraction", () => {
    load("loop.dat", "Magnetic Field", "Oe");
    const { unmount } = render(<MagToolsPanel />);
    expect((screen.getByLabelText("High-field fraction") as HTMLInputElement).value).toBe("0.7");
    unmount();

    load("mt.dat", "Temperature", "K");
    render(<MagToolsPanel />);
    expect((screen.getByLabelText("High-T fraction") as HTMLInputElement).value).toBe("0.1");
  });
});

describe("MagToolsPanel — internal-field correction is explicit", () => {
  it("requires a geometry and explains the volume-normalization prerequisite", () => {
    load("loop.dat", "Magnetic Field", "Oe");
    render(<MagToolsPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Internal field" }));

    expect(screen.getByLabelText("Sample geometry and field direction")).toHaveValue("");
    expect(screen.getByRole("button", { name: /Create internal-field dataset/ })).toBeDisabled();
    expect(screen.getByText(/must already be normalized by sample volume/)).toBeInTheDocument();
  });
});

describe("MagToolsPanel — loaded-data Curie-Weiss fit", () => {
  it("is a first-class tab and refuses raw moment without sample context", () => {
    load("mt.dat", "Temperature", "K");
    render(<MagToolsPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Curie–Weiss" }));
    expect(screen.getByText(/editable inverse-susceptibility worksheet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Curie–Weiss fit/ })).toBeDisabled();
    expect(screen.getByText(/positive molar mass/)).toBeInTheDocument();
  });
});

describe("MagToolsPanel — ambiguous data fails closed in the UI", () => {
  it("disables the action and says what it could not determine", () => {
    load("mystery.dat", "col 1", "");
    render(<MagToolsPanel />);

    expect(subtractButton()).toBeDisabled();
    expect(screen.getByText(/Cannot tell M\(T\) from M\(H\)/)).toBeInTheDocument();
  });

  it("the user can pick the data type, which enables the action", () => {
    load("mystery.dat", "col 1", "");
    render(<MagToolsPanel />);
    expect(subtractButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Data type"), { target: { value: "mh" } });

    expect(subtractButton()).toBeEnabled();
    expect(screen.getByText(/both saturated tails/)).toBeInTheDocument();
    expect(screen.getByLabelText("High-field fraction")).toBeInTheDocument();
  });

  it("an explicit choice overrides the detection", () => {
    load("loop.dat", "Magnetic Field", "Oe");
    render(<MagToolsPanel />);
    expect(screen.getByLabelText("High-field fraction")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Data type"), { target: { value: "mt" } });

    expect(screen.getByLabelText("High-T fraction")).toBeInTheDocument();
    expect(screen.getByText(/high-T tail of M\(T\)/)).toBeInTheDocument();
  });
});

describe("MagToolsPanel — the fit readout names its units (round-3 plot audit)", () => {
  it("an M(H) run reports χ in moment/field and the offset in moment", async () => {
    load("loop.dat", "Magnetic Field", "Oe");
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: [-1, 0, 1],
      slope: -1.6e-7,
      offset: 2e-6,
    });
    render(<MagToolsPanel />);
    fireEvent.click(subtractButton());
    expect(await screen.findByText(/emu\/Oe/)).toHaveTextContent(/offset .* emu$/);
  });

  it("an M(T) run reports the slope in moment/temperature and the intercept in moment", async () => {
    load("mt.dat", "Temperature", "K");
    vi.mocked(subtractMagBackground).mockResolvedValue({
      corrected: [-1, 0, 1],
      slope: -1.2e-6,
      intercept: 7e-4,
    });
    render(<MagToolsPanel />);
    fireEvent.click(subtractButton());
    expect(await screen.findByText(/emu\/K/)).toHaveTextContent(/intercept .* emu$/);
  });
});

describe("MagToolsPanel — sample geometry", () => {
  it("blocks incomplete volume normalization and previews mixed-unit film volume", () => {
    load("loop.dat", "Magnetic Field", "Oe");
    render(<MagToolsPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Units" }));
    expect(screen.getByText(/Moment emu/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Target moment unit"), { target: { value: "A/m" } });
    expect(screen.getByLabelText("Target moment unit")).toHaveValue("A/m");
    expect(screen.getByRole("button", { name: /Convert/ })).toBeDisabled();
    expect(screen.getByText(/positive sample geometry/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Volume geometry"), { target: { value: "film" } });
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Thickness"), { target: { value: "30" } });
    expect(screen.getByText(/Calculated volume:/)).toHaveTextContent(/7\.5.*(?:e-5|10)|0\.000075/i);
    expect(screen.getByRole("button", { name: /Convert/ })).toBeEnabled();
  });
});
