// Acceptance 10 C2: the preset bar's "Settings:" line follows the panel. After an
// edit from the defaults it reads "(edited)"; after Save as it names the saved
// preset; an edit after that shows it modified; Rename follows. Through the real
// Resample panel and its preset bar.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lastUsedSlot } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { useResampleDialog } from "../../../store/resampleDialog";
import { useApp } from "../../../store/useApp";
import ResamplePanel from "../resample/ResamplePanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/resample", () => ({ resampleDataset: vi.fn(() => new Promise(() => undefined)) }));

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
const points = (v: string) => fireEvent.change(screen.getByRole("textbox", { name: "Number of points" }), { target: { value: v } });
const source = () => within(screen.getByRole("region", { name: "Resample presets" })).getByText(/^Settings: /).textContent;

describe("the preset bar's source line", () => {
  it("shows the edit, then the saved preset, then the edit of that preset, then its new name", async () => {
    render(<ResamplePanel />);
    await screen.findByRole("region", { name: "Resample presets" });
    expect(source()).toBe("Settings: Defaults");
    const opened = (screen.getByRole("textbox", { name: "Number of points" }) as HTMLInputElement).value;
    points("55");
    expect(source()).toBe("Settings: Defaults (edited)");
    points(opened); // back to what the panel opened with
    expect(source()).toBe("Settings: Defaults");
    points("55");

    press("Save as…");
    fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: "Mine" } });
    press("Save");
    await screen.findByText("Saved preset 'Mine'");
    expect(source()).toBe("Settings: Preset 'Mine'");

    points("66");
    expect(source()).toBe("Settings: Preset 'Mine' (edited)");

    press("Rename…");
    fireEvent.change(screen.getByRole("textbox", { name: "New preset name" }), { target: { value: "Yours" } });
    press("Save");
    await screen.findByText("Renamed to 'Yours'");
    expect(source()).toBe("Settings: Preset 'Yours' (edited)");
  });
});
