// Soak-fix reviews 3 and 4: a startup restore that lands where it could
// overwrite or mix with the user's work is OFFERED, never applied —
// "Recovered previous session — Append / Replace / Discard". Each answer:
//  - Replace asks File ▸ Open's confirmation over content (F1), restores the
//    whole workspace as an unnamed library and settles; Cancel keeps all;
//  - Append adds the full library beside the current work — workbooks back
//    in their folders (F3) — keeps the pin, and then offers only Replace or
//    Discard (F4); a Replace answered while it loads wins (F5);
//  - Discard asks first, then settles and applies nothing;
//  - a failed Append keeps the prompt answerable (R6);
//  - a workspace replace while pending keeps it and says so (F6);
//  - re-offering never stacks prompts (F9); the marker survives a reload (F2).

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../store/useApp";
import { useToasts } from "../store/toasts";
import { autosaveHealth, autosaveRestoreSettled, PENDING_RECOVERY_KEY, setAutosaveBackend } from "./autosave";
import { memoryBackend } from "./autosaveBackend";
import { appendRecovered, discardRecovered, offerLateRestore, reofferLateRestore, replaceRecovered, resetLateRestore } from "./lateRestore";
import { buildLibraryHierarchy, type LibraryNodeKey } from "./libraryHierarchy";
import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const { askConfirm } = vi.hoisted(() => ({ askConfirm: vi.fn<(...a: unknown[]) => Promise<boolean>>() }));
vi.mock("../store/confirmDialog", () => ({ askConfirm }));
vi.mock("./api", () => ({ fetchBookData: vi.fn() }));

const ds = (id: string, name: string, folderId?: string): Dataset => ({
  id,
  name,
  ...(folderId ? { folderId } : {}),
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});

/** The recovered session: a dataset in a workbook inside a folder, plus a report. */
const recovered = () =>
  parseWorkspace(
    serializeWorkspace({
      datasets: [{ ...ds("old-1", "old.dat"), workbookId: "wb-old" }],
      workbooks: [{ id: "wb-old", name: "old book", folderId: "fold-1", order: 0 } as never],
      folders: [{ id: "fold-1", name: "SEED-FOLDER", parentId: null, order: 0 }],
      reports: [{ id: "rep-1", name: "old report", datasetId: "old-1", report: { title: "old report", sections: [] } }],
    }),
  );

const prompts = () => useToasts.getState().toasts.filter((t) => t.msg.startsWith("Recovered previous session"));
const lastPrompt = () => prompts().at(-1);
const pending = () => autosaveHealth().restoreError;

beforeEach(() => {
  askConfirm.mockReset().mockResolvedValue(true);
  resetLateRestore();
  localStorage.removeItem(PENDING_RECOVERY_KEY);
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
    expect(lastPrompt()?.msg).toMatch(/^Recovered previous session \(1 dataset, .*\) — Append, Replace or Discard\?$/);
    expect(lastPrompt()?.actions?.map((a) => a.label)).toEqual(["Append", "Replace", "Discard"]);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["mine.dat"]);
    expect(pending()).toMatch(/Append, Replace or Discard/);
  });

  it("keeps the pending recovery in a marker that survives a reload (F2)", () => {
    expect(Number(localStorage.getItem(PENDING_RECOVERY_KEY))).toBeGreaterThan(0);
  });

  it("re-offering replaces the prompt instead of stacking another (F9)", () => {
    reofferLateRestore();
    reofferLateRestore();
    expect(prompts()).toHaveLength(1);
  });
});

describe("Replace (F1)", () => {
  it("asks File ▸ Open's question over existing content; Cancel keeps everything, the pin included", async () => {
    askConfirm.mockResolvedValue(false);
    await act(async () => {
      expect(await replaceRecovered()).toBe(false);
    });
    expect(askConfirm).toHaveBeenCalledWith("Replace the current workspace?", expect.stringContaining("1 dataset"), "Replace", true);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["mine.dat"]);
    expect(useApp.getState().currentProject?.path).toBe("/work/opened.dwk");
    expect(pending()).toMatch(/Append, Replace or Discard/);
  });

  it("once confirmed, restores the WHOLE workspace as an unnamed library and settles", async () => {
    await act(async () => {
      expect(await replaceRecovered()).toBe(true);
    });
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.name)).toEqual(["old.dat"]);
    expect(s.folders.map((f) => f.name)).toEqual(["SEED-FOLDER"]);
    expect(s.reports.map((r) => r.id)).toEqual(["rep-1"]);
    expect(s.currentProject).toBeNull(); // never under the opened project's name
    expect(pending()).toBeUndefined();
    expect(localStorage.getItem(PENDING_RECOVERY_KEY)).toBeNull();
  });
});

describe("Append", () => {
  const ancestors = (key: LibraryNodeKey): LibraryNodeKey[] => {
    const s = useApp.getState();
    const tree = buildLibraryHierarchy({ folders: s.folders, workbooks: s.workbooks, datasets: s.datasets });
    const out: LibraryNodeKey[] = [];
    for (let k = tree.byKey.get(key)?.parentKey ?? null; k; k = tree.byKey.get(k)?.parentKey ?? null) out.push(k);
    return out;
  };

  it("adds the full library beside the current work — the workbook back in its folder (F3) — and KEEPS the pin", async () => {
    await act(async () => {
      expect(await appendRecovered()).toBe(true);
    });
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.name).sort()).toEqual(["mine.dat", "old.dat"]);
    expect(s.reports.map((r) => r.id)).toEqual(["rep-1"]);
    const old = s.datasets.find((d) => d.name === "old.dat")!;
    expect(ancestors(`worksheet:${old.id}`)).toContain("folder:fold-1"); // placed as the Library shows it
    expect(s.currentProject?.path).toBe("/work/opened.dwk");
    expect(pending()).toMatch(/kept until you Replace or Discard/);
    expect(autosaveHealth().restoreKept).toBe(true);
  });

  it("then offers only Replace or Discard; a second Append does nothing (F4)", async () => {
    await act(async () => {
      await appendRecovered();
    });
    reofferLateRestore();
    expect(lastPrompt()?.actions?.map((a) => a.label)).toEqual(["Replace", "Discard"]);
    await act(async () => {
      expect(await appendRecovered()).toBe(false);
    });
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("a Replace answered while the merge code loads wins; the Append neither applies nor re-pins (F5)", async () => {
    const real = useApp.getState().appendWorkspace;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    useApp.setState({ appendWorkspace: async (w) => (await gate, real(w)) });
    let appending!: Promise<boolean>;
    act(() => {
      appending = appendRecovered();
    });
    await act(async () => {
      expect(await replaceRecovered()).toBe(true);
    });
    release();
    await act(async () => {
      expect(await appending).toBe(false);
    });
    expect(pending()).toBeUndefined();
    expect(autosaveHealth().restoreKept).toBeUndefined();
  });

  it("a failed Append is reported and leaves the prompt answerable (R6)", async () => {
    useApp.setState({ appendWorkspace: vi.fn().mockRejectedValue(new Error("chunk gone")) });
    await act(async () => {
      expect(await appendRecovered()).toBe(false);
    });
    expect(pending()).toMatch(/^Couldn't append the previous session \(chunk gone\)/);
    await act(async () => {
      expect(await replaceRecovered()).toBe(true); // still there to answer
    });
  });
});

describe("Discard", () => {
  it("asks first; Cancel keeps the pin", async () => {
    askConfirm.mockResolvedValue(false);
    await act(async () => {
      expect(await discardRecovered()).toBe(false);
    });
    expect(askConfirm).toHaveBeenCalledWith("Discard the previous session?", expect.any(String), "Discard", true);
    expect(pending()).toMatch(/Append, Replace or Discard/);
  });

  it("once confirmed, applies nothing, settles and drops the marker", async () => {
    await act(async () => {
      expect(await discardRecovered()).toBe(true);
    });
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["mine.dat"]);
    expect(pending()).toBeUndefined();
    expect(localStorage.getItem(PENDING_RECOVERY_KEY)).toBeNull();
  });
});

describe("a workspace replace while a recovery is pending (F6)", () => {
  it("keeps it — Remove all never discards the previous session — and says so", () => {
    act(() => useApp.getState().clearAll());
    expect(pending()).toMatch(/Append, Replace or Discard/);
    expect(useToasts.getState().toasts.some((t) => /still kept/.test(t.msg))).toBe(true);
  });
});
