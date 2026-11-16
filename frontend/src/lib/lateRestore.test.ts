// Soak-fix review 3 (R2/R3/R5/R7/R6): a startup restore that lands where it
// could overwrite or mix with the user's work is OFFERED, never applied —
// "Recovered previous session — Append / Replace / Discard". Each answer:
//  - Replace restores the whole workspace as an unnamed library and settles;
//  - Append adds the full library beside the current work, keeping the pin;
//  - Discard settles and applies nothing;
//  - a failed Append keeps the prompt answerable.

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../store/useApp";
import { useToasts } from "../store/toasts";
import { autosaveHealth, autosaveRestoreSettled, setAutosaveBackend } from "./autosave";
import { memoryBackend } from "./autosaveBackend";
import { appendRecovered, discardRecovered, offerLateRestore, replaceRecovered, resetLateRestore } from "./lateRestore";
import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";

vi.mock("./api", () => ({ fetchBookData: vi.fn() }));

const ds = (id: string, name: string, folderId?: string): Dataset => ({
  id,
  name,
  ...(folderId ? { folderId } : {}),
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});

/** The recovered session: a dataset inside a folder, plus a report. */
const recovered = () =>
  parseWorkspace(
    serializeWorkspace({
      datasets: [ds("old-1", "old.dat", "fold-1")],
      folders: [{ id: "fold-1", name: "SEED-FOLDER", parentId: null, order: 0 }],
      reports: [{ id: "rep-1", name: "old report", datasetId: "old-1", report: { title: "old report", sections: [] } }],
    }),
  );

const lastToast = () => useToasts.getState().toasts.at(-1);

beforeEach(() => {
  resetLateRestore();
  setAutosaveBackend(memoryBackend());
  useToasts.setState({ toasts: [] });
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [ds("mine-1", "mine.dat")],
    currentProject: { name: "opened", path: "/work/opened.dwk" },
  });
  offerLateRestore({ workspace: recovered(), at: Date.parse("2026-11-01T00:00:00Z") });
});

afterEach(() => {
  autosaveRestoreSettled();
});

describe("the late-restore prompt", () => {
  it("asks — Append / Replace / Discard — and applies nothing meanwhile", () => {
    expect(lastToast()?.msg).toMatch(/^Recovered previous session \(1 dataset, .*\) — Append, Replace or Discard\?$/);
    expect(lastToast()?.actions?.map((a) => a.label)).toEqual(["Append", "Replace", "Discard"]);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["mine.dat"]);
    expect(useApp.getState().currentProject?.path).toBe("/work/opened.dwk");
    expect(autosaveHealth().restoreError).toMatch(/Append, Replace or Discard/); // pinned
  });

  it("Replace restores the WHOLE workspace as an unnamed library, and settles", () => {
    act(() => {
      expect(replaceRecovered()).toBe(true);
    });
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.name)).toEqual(["old.dat"]);
    expect(s.folders.map((f) => f.name)).toEqual(["SEED-FOLDER"]);
    expect(s.reports.map((r) => r.id)).toEqual(["rep-1"]);
    expect(s.currentProject).toBeNull(); // never under the opened project's name
    expect(autosaveHealth().restoreError).toBeUndefined();
  });

  it("Append adds the full library beside the current work, and KEEPS the pin", async () => {
    await act(async () => {
      expect(await appendRecovered()).toBe(true);
    });
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.name).sort()).toEqual(["mine.dat", "old.dat"]);
    expect(s.folders.map((f) => f.name)).toEqual(["SEED-FOLDER"]);
    expect(s.datasets.find((d) => d.name === "old.dat")?.folderId).toBe("fold-1");
    expect(s.reports.map((r) => r.id)).toEqual(["rep-1"]);
    expect(s.currentProject?.path).toBe("/work/opened.dwk"); // identity untouched
    // Still pinned — and reported as KEPT, not "not restored".
    expect(autosaveHealth().restoreError).toMatch(/kept until you Replace or Discard/);
    expect(autosaveHealth().restoreKept).toBe(true);
  });

  it("Discard applies nothing and settles", () => {
    act(() => discardRecovered());
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["mine.dat"]);
    expect(autosaveHealth().restoreError).toBeUndefined();
  });

  it("a failed Append is reported and leaves the prompt answerable (review R6)", async () => {
    const spy = vi.spyOn(useApp.getState(), "appendWorkspace").mockRejectedValue(new Error("chunk gone"));
    useApp.setState({ appendWorkspace: spy });
    await act(async () => {
      expect(await appendRecovered()).toBe(false);
    });
    expect(autosaveHealth().restoreError).toMatch(/^Couldn't append the previous session \(chunk gone\)/);
    act(() => {
      expect(replaceRecovered()).toBe(true); // still there to answer
    });
  });
});
