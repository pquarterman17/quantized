// "Manage presets…" on the real Resample panel (item 40 slice P5): Export to a
// file, then Import it into clean storage; a clash gets "(imported)"; a
// malformed file imports nothing and says why.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lastUsedSlot } from "../../../lib/presetLastUsed";
import { PRESETS_KEY } from "../../../lib/presets";
import type { DataStruct } from "../../../lib/types";
import { useResampleDialog } from "../../../store/resampleDialog";
import { useApp } from "../../../store/useApp";
import ResamplePanel from "../resample/ResamplePanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/resample", () => ({ resampleDataset: vi.fn(() => new Promise(() => undefined)) }));
vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));
const { saveBlob } = await import("../../../lib/download");

const a: DataStruct = { time: [0, 1, 2, 3], values: [[0], [10], [20], [30]], labels: ["M"], units: ["emu"], metadata: { x_column_unit: "K" } };

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  vi.clearAllMocks();
  useApp.setState({ datasets: [{ id: "d1", name: "a.dat", data: a }], folders: [], activeId: "d1", selectedIds: ["d1"], macroSteps: [], history: [], future: [] });
  useResampleDialog.setState({ seed: ["d1"] });
});

const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const points = () => screen.getByRole("textbox", { name: "Number of points" });
const select = () => screen.getByRole("combobox", { name: "Preset" });

async function savePresetNamed(n: string, name: string) {
  fireEvent.change(points(), { target: { value: n } });
  press("Save as…");
  fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: name } });
  press("Save");
  await screen.findByText(`Saved preset '${name}'`);
}

async function openManager() {
  press("Manage presets…");
  return screen.findByRole("group", { name: "Manage presets" });
}

function chooseFile(text: string) {
  const input = screen.getByLabelText("Preset file") as HTMLInputElement;
  const file = new File([text], "p.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) }); // jsdom lacks Blob.text
  fireEvent.change(input, { target: { files: [file] } });
}

const exported = () => {
  const [blob] = vi.mocked(saveBlob).mock.calls.at(-1) as [Blob, string];
  return new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(blob);
  });
};

describe("Manage presets on the Resample bar", () => {
  it("exports this tool's presets, and importing that file into clean storage restores them", async () => {
    render(<ResamplePanel />);
    await screen.findByRole("region", { name: "Resample presets" });
    await savePresetNamed("77", "Dense");
    const group = await openManager();
    fireEvent.click(within(group).getByRole("button", { name: "Export Resample presets" }));
    await screen.findByText("Exported 1 preset");
    expect(vi.mocked(saveBlob).mock.calls[0][1]).toBe("quantized-presets-resample.json");
    const text = await exported();
    expect(JSON.parse(text)).toMatchObject({ kind: "qz-presets", version: 1, presets: [{ workshop: "resample", name: "Dense", schema: 1, settings: { nPoints: "77" } }] });

    localStorage.removeItem(PRESETS_KEY);
    cleanup();
    render(<ResamplePanel />);
    await screen.findByRole("region", { name: "Resample presets" });
    expect(within(select()).queryByRole("option", { name: "Dense" })).toBeNull();
    await openManager();
    chooseFile(text);
    await screen.findByText(/Imported 1 preset, 0 locked/);
    // The bar's list refreshed without a remount.
    expect(within(select()).getByRole("option", { name: "Dense" })).toBeTruthy();
  });

  it("a clash is renamed '(imported)' and the status says so; nothing is overwritten", async () => {
    render(<ResamplePanel />);
    await screen.findByRole("region", { name: "Resample presets" });
    await savePresetNamed("77", "Dense");
    await openManager();
    chooseFile(JSON.stringify({ kind: "qz-presets", version: 1, presets: [{ workshop: "resample", name: "Dense", schema: 1, settings: JSON.parse(localStorage.getItem(PRESETS_KEY)!).presets[0].settings }] }));
    await screen.findByText(/Renamed to avoid a clash: 'Dense' to 'Dense \(imported\)'/);
    expect(within(select()).getByRole("option", { name: "Dense" })).toBeTruthy();
    expect(within(select()).getByRole("option", { name: "Dense (imported)" })).toBeTruthy();
  });

  it("a malformed file imports nothing and says why", async () => {
    render(<ResamplePanel />);
    await screen.findByRole("region", { name: "Resample presets" });
    await savePresetNamed("77", "Dense");
    const before = localStorage.getItem(PRESETS_KEY);
    await openManager();
    chooseFile("{ definitely not json");
    await screen.findByText("Nothing was imported: the file is not valid JSON");
    expect(localStorage.getItem(PRESETS_KEY)).toBe(before);
  });

  it("reports a newer-schema preset as locked and an unknown field as skipped with the field named", async () => {
    render(<ResamplePanel />);
    await screen.findByRole("region", { name: "Resample presets" });
    const good = { mode: "n_points", nPoints: "9", step: "", start: "", stop: "", rangeStep: "", method: "linear", outOfRange: "nan", sortUnsorted: false };
    await openManager();
    chooseFile(JSON.stringify({ kind: "qz-presets", version: 1, presets: [
      { workshop: "resample", name: "Future", schema: 2, settings: { whatever: 1 } },
      { workshop: "resample", name: "Edited", schema: 1, settings: { ...good, datasetId: "d1" } },
      { workshop: "resample", name: "Fine", schema: 1, settings: good },
    ] }));
    const status = await screen.findByText(/Imported 1 preset, 1 locked/);
    expect(status.textContent).toContain("1 skipped");
    expect(status.textContent).toContain("'Edited' (resample): setting 'datasetId' is not known to this version");
    expect(within(select()).getByRole("option", { name: /Future — locked/ })).toBeTruthy();
  });

  it("Export all presets writes every tool's file name, and 'nothing to export' is said, not downloaded", async () => {
    render(<ResamplePanel />);
    await screen.findByRole("region", { name: "Resample presets" });
    const group = await openManager();
    fireEvent.click(within(group).getByRole("button", { name: "Export all presets" }));
    await screen.findByText("Nothing was exported: there are no presets to export");
    expect(saveBlob).not.toHaveBeenCalled();
    await savePresetNamed("77", "Dense");
    fireEvent.click(within(group).getByRole("button", { name: "Export all presets" }));
    await screen.findByText("Exported 1 preset");
    expect(vi.mocked(saveBlob).mock.calls[0][1]).toBe("quantized-presets.json");
  });
});
