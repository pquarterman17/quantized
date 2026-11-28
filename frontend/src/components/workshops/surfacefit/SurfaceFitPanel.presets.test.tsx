// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9), through the real
// Surface fit panel, hook and storage: save, change, Apply restores the columns
// and the model and the next fit request carries them; Revert; Apply fits nothing
// and writes no last used, a successful fit does; a column this sheet lacks is
// named and skipped; start values are the panel's own (estimated), not stored.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SurfaceFitResult } from "../../../lib/api/analysisExtras";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useApp } from "../../../store/useApp";
import SurfaceFitPanel from "./SurfaceFitPanel";

const { modelsMock, guessMock, fitMock } = vi.hoisted(() => ({ modelsMock: vi.fn(), guessMock: vi.fn(), fitMock: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({ surfaceModels: modelsMock, surfaceGuess: guessMock, surfaceFit: fitMock }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

const DATA: DataStruct = {
  time: [0, 1, 0, 1],
  values: [[0, 1], [0, 2], [1, 3], [1, 5]],
  labels: ["Y", "Z"],
  units: ["mm", "V"],
  metadata: { x_column_name: "X", x_column_unit: "mm" },
};
const OTHER: DataStruct = { ...DATA, labels: ["Y", "W"] };
const PARAMS: Record<string, string[]> = { Plane: ["a", "b", "c"], Paraboloid: ["a", "b", "c", "d", "e", "f"] };

const resultFor = (model: string): SurfaceFitResult => {
  const names = PARAMS[model] ?? [];
  return {
    model_name: model, param_names: names, params: names.map(() => 1), errors: names.map(() => 0.1),
    inference: names.map(() => ({ value: 1, error: 0.1, t: 10, prob: 0.01, lcl: 0.8, ucl: 1.2 })),
    level: 0.95, fixed: names.map(() => false), z_fit: [1, 2, 3, 4], residuals: [0, 0, 0, 1],
    r2: 0.9, rmse: 0.5, chi_sq_red: 0.25, n_points: 4, n_free: names.length, dof: 1, exit_flag: 1,
  };
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  modelsMock.mockResolvedValue(Object.entries(PARAMS).map(([name, param_names]) => ({ name, param_names, description: name })));
  guessMock.mockImplementation(async ({ model }: { model: string }) => ({ param_names: PARAMS[model], p0: (PARAMS[model] ?? []).map(() => 1) }));
  fitMock.mockImplementation(async ({ model }: { model: string }) => resultFor(model));
  useApp.setState({
    datasets: [{ id: "d1", name: "map.csv", data: DATA }, { id: "d2", name: "other.csv", data: OTHER }],
    activeId: "d1", status: "", analysisResults: [], history: [], future: [],
  });
});

const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Surface fit presets" })).getByRole("status").textContent ?? "";
const combo = (name: string) => screen.getByRole("combobox", { name }) as HTMLSelectElement;
function savePreset(name: string) {
  press("Save as…");
  fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: name } });
  press("Save");
}
function pick(label: string) {
  const opt = within(select()).getAllByRole("option").find((o) => o.textContent?.startsWith(label));
  if (!opt) throw new Error(`no option ${label}`);
  fireEvent.change(select(), { target: { value: (opt as HTMLOptionElement).value } });
}
async function ready() {
  render(<SurfaceFitPanel />);
  await screen.findByRole("region", { name: "Surface fit presets" });
  await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("1"));
}

describe("Surface fit preset bar", () => {
  it("saves, changes, Applies: columns and model return and the next fit carries them; Revert; last used is a fit's", async () => {
    await ready();
    fireEvent.change(combo("Model"), { target: { value: "Paraboloid" } });
    fireEvent.change(combo("Y column"), { target: { value: "1" } });
    fireEvent.change(combo("Z column"), { target: { value: "0" } });
    savePreset("Swapped paraboloid");
    expect(status()).toBe("Saved preset 'Swapped paraboloid'");
    fireEvent.change(combo("Model"), { target: { value: "Plane" } });
    fireEvent.change(combo("Y column"), { target: { value: "0" } });
    fireEvent.change(combo("Z column"), { target: { value: "1" } });
    pick("Swapped paraboloid");
    press("Apply");
    expect(status()).toContain("Applied preset 'Swapped paraboloid' to Surface fit: press Fit to run it");
    expect(combo("Model").value).toBe("Paraboloid");
    expect(combo("Y column").value).toBe("1"); // by label
    expect(combo("Z column").value).toBe("0");
    expect(fitMock).not.toHaveBeenCalled();
    expect(readLastUsed("surface-fit")).toBeNull();
    press("Revert");
    expect(combo("Model").value).toBe("Plane");
    expect(combo("Z column").value).toBe("1");
    pick("Swapped paraboloid");
    press("Apply");
    await waitFor(() => expect(screen.getByLabelText("Start f")).toHaveValue("1")); // start values re-estimated for the model
    await waitFor(() => expect(screen.getByRole("button", { name: "Fit" })).not.toBeDisabled());
    press("Fit");
    await waitFor(() => expect(readLastUsed("surface-fit")).not.toBeNull());
    expect(fitMock.mock.calls[0]?.[0]).toMatchObject({ model: "Paraboloid", y: [1, 2, 3, 5], z: [0, 0, 1, 1] });
    expect(readLastUsed("surface-fit")?.settings).toEqual({ xColumn: "X", yColumn: "Z", zColumn: "Y", model: "Paraboloid" });
    cleanup();
    await ready();
    expect(within(select()).getByRole("option", { name: "Swapped paraboloid" })).toBeTruthy();
  });

  it("a failed fit writes no last used", async () => {
    fitMock.mockRejectedValueOnce(new Error("did not converge"));
    await ready();
    press("Fit");
    expect(await screen.findByText("did not converge")).toBeInTheDocument();
    expect(readLastUsed("surface-fit")).toBeNull();
  });

  it("a column this sheet lacks is named and skipped, and the current pick stays", async () => {
    await ready();
    savePreset("Needs Z");
    act(() => useApp.setState({ activeId: "d2" }));
    await waitFor(() => expect(combo("Z column")).toHaveValue("1"));
    pick("Needs Z");
    press("Apply");
    expect(status()).toContain("Z column skipped (column 'Z' is not on this sheet)");
    expect(combo("Z column").value).toBe("1");
  });
});
