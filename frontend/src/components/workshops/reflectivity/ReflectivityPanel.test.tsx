import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflPresets } from "../../../lib/api/reflectivity";
import type { SldPreset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import ReflectivityPanel from "./ReflectivityPanel";

vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
  reflFit: vi.fn(),
}));

const PRESETS: SldPreset[] = [
  { name: "Air / Vacuum", formula: "", sldX: 0, sldN: 0, sldImag: 0, density: 0 },
  { name: "Nickel", formula: "Ni", sldX: 7.18e-5, sldN: 9.4e-6, sldImag: 5e-7, density: 8.9 },
  { name: "Silicon", formula: "Si", sldX: 2.007e-5, sldN: 2.073e-6, sldImag: 0, density: 2.33 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reflPresets).mockResolvedValue({ presets: PRESETS });
  useApp.setState({ datasets: [], activeId: null, status: "", reflectivitySeed: null });
});

describe("ReflectivityPanel", () => {
  it("switches Model ⇄ Fit over one shared layer model", async () => {
    render(<ReflectivityPanel />);
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Nickel" }).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Simulate R(Q)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Fit" }));
    expect(screen.queryByRole("button", { name: "Simulate R(Q)" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run fit" })).toBeDisabled(); // no dataset yet
    // the parameter table is generated from the same stack the Model mode edits
    const thickness = screen.getByRole("textbox", { name: "L1.thickness value" }) as HTMLInputElement;
    expect(thickness.value).toBe("200");
    fireEvent.change(thickness, { target: { value: "150" } });

    fireEvent.click(screen.getByRole("tab", { name: "Model" }));
    // the layer table's film thickness field now reads the edited value
    expect(screen.getAllByRole("textbox").some((el) => (el as HTMLInputElement).value === "150")).toBe(true);
  });
});
