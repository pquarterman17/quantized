// The XRD tools' CIF lattice-preset picker: load a .cif in place (it joins the
// imported presets and is applied), pick an imported one, and say why a
// structure gives no preset or a file cannot be read.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadStructure, type CrystalStructure } from "../../../lib/api/structures";
import { openFilePicker } from "../../../lib/openFilePicker";
import { useCrystalStructures } from "../../../store/crystalStructures";
import StructurePresetPicker from "./StructurePresetPicker";

vi.mock("../../../lib/api/structures", () => ({ uploadStructure: vi.fn() }));
vi.mock("../../../lib/openFilePicker", () => ({ openFilePicker: vi.fn() }));

const SI: CrystalStructure = {
  name: "Si", source_name: "si.cif", formula: "Si", space_group: "F d -3 m",
  cell: { a: 5.4309, b: 5.4309, c: 5.4309, alpha: 90, beta: 90, gamma: 90 }, atom_sites: [],
};
const FILE = new File(["data_Si"], "si.cif");

beforeEach(() => {
  vi.clearAllMocks();
  useCrystalStructures.setState({ presets: [] });
  vi.mocked(openFilePicker).mockImplementation((onPick) => onPick([FILE]));
});

describe("StructurePresetPicker", () => {
  it("loads a CIF, lists it as a preset and applies its lattice", async () => {
    vi.mocked(uploadStructure).mockResolvedValue(SI);
    const onApply = vi.fn();
    render(<StructurePresetPicker onApply={onApply} />);
    expect(screen.getByLabelText("lattice preset")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Load CIF…" }));
    await screen.findByRole("option", { name: "Si (Si, F d -3 m)" });
    expect(vi.mocked(openFilePicker).mock.calls[0][1]).toBe(".cif");
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ tie: "abc", centering: "F", system: "cubic" }),
      expect.objectContaining({ name: "Si" }),
    );
    expect(useCrystalStructures.getState().presets).toHaveLength(1);
  });

  it("names why an imported structure gives no preset, and applies nothing", () => {
    useCrystalStructures.getState().addStructure({ ...SI, cell: { ...SI.cell, c: null } });
    const onApply = vi.fn();
    render(<StructurePresetPicker onApply={onApply} />);
    const id = useCrystalStructures.getState().presets[0].id;
    fireEvent.change(screen.getByLabelText("lattice preset"), { target: { value: id } });
    expect(screen.getByRole("alert")).toHaveTextContent("Si: the CIF gives no c length");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal of a file", async () => {
    vi.mocked(uploadStructure).mockRejectedValue(new Error("'si.cif' has no unit cell"));
    render(<StructurePresetPicker onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Load CIF…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("has no unit cell");
  });
});
