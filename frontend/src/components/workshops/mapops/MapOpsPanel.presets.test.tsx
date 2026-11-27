// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P5), through the
// real Map operations panel, hook, store and storage: save, change, Apply
// restores the form and the next run's request carries it, Apply runs nothing
// and writes no last used, a successful run does, and a refused value in a
// hidden knob does not block Save.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useApp } from "../../../store/useApp";
import MapOpsPanel from "./MapOpsPanel";

const { applyMock } = vi.hoisted(() => ({ applyMock: vi.fn() }));
vi.mock("../../../lib/api/mapOps", () => ({ mapOpApply: applyMock }));

const grid: DataStruct = {
  time: [0, 1, 0, 1],
  values: [[0, 0, 1], [1, 0, 2], [0, 1, 3], [1, 1, 4]],
  labels: ["Qx", "Qz", "Intensity"],
  units: ["1/A", "1/nm", "cts"],
  metadata: { is2D: true, map_shape: [2, 2], map_grid: "native", x_column_name: "Qx" },
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  applyMock.mockResolvedValue({ ...grid, metadata: { ...grid.metadata, map_op: { op: "rotate" } } });
  useApp.setState({ datasets: [{ id: "a", name: "rsm.xrdml", data: grid }], activeId: "a", status: "", analysisResults: [], history: [], future: [] });
});

const op = () => screen.getByLabelText("Map operation") as HTMLSelectElement;
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Map operations presets" })).getByRole("status").textContent ?? "";
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
  render(<MapOpsPanel />);
  await screen.findByRole("region", { name: "Map operations presets" });
}

describe("Map operations preset bar", () => {
  it("saves, changes, Applies: the form returns and the next run's request carries it", async () => {
    await ready();
    fireEvent.change(op(), { target: { value: "rotate" } });
    fireEvent.change(screen.getByLabelText("Rotation"), { target: { value: "270" } });
    savePreset("Quarter back");
    expect(status()).toBe("Saved preset 'Quarter back'");
    fireEvent.change(op(), { target: { value: "flip" } });
    pick("Quarter back");
    press("Apply");
    expect(status()).toContain("Applied preset 'Quarter back' to Map operations: press Apply → new dataset to run it");
    expect(op().value).toBe("rotate");
    expect((screen.getByLabelText("Rotation") as HTMLSelectElement).value).toBe("270");
    // Apply ran nothing and wrote no last used.
    expect(applyMock).not.toHaveBeenCalled();
    expect(readLastUsed("map-ops")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Apply → new dataset/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    expect(applyMock.mock.calls[0]?.[0]).toMatchObject({ op: "rotate", degrees: 270 });
    await waitFor(() => expect(readLastUsed("map-ops")).not.toBeNull());
    expect(readLastUsed("map-ops")?.settings).toMatchObject({ op: "rotate", degrees: "270" });
    // Remounted: still listed.
    cleanup();
    await ready();
    expect(within(select()).getByRole("option", { name: "Quarter back" })).toBeTruthy();
  });

  it("a refused value in a knob the operation hides does not block Save", async () => {
    await ready();
    fireEvent.change(op(), { target: { value: "imgfilter" } });
    fireEvent.change(screen.getByLabelText("Sigma (pixels)"), { target: { value: "-3" } }); // Gaussian shows sigma: refused
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "laplacian" } }); // now sigma is hidden
    savePreset("Edges");
    expect(status()).toBe("Saved preset 'Edges'");
    const stored = JSON.parse(localStorage.getItem("qz.presets") ?? "{}").presets[0].settings;
    expect(stored).toMatchObject({ op: "imgfilter", imgKind: "laplacian", sigma: "1" });
  });
});
