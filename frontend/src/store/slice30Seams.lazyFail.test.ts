// Bundle diet slice 30 (plans/BUNDLE_HEADROOM.md): three async store actions
// load their bodies on first use. A body that will not load is reported and
// changes nothing. Its own file because `vi.doMock` must be registered before
// each body's first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, Dataset } from "../lib/types";
import type { LoadedWorkspace } from "../lib/workspace";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const base: DataStruct = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["m"], units: ["emu"], metadata: {} };
const ds = (id: string): Dataset => ({ id, name: `${id}.dat`, data: base });
const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [ds("d1")], activeId: "d1", history: [], future: [], status: "" });
});

afterEach(() => {
  vi.doUnmock("./derivedWorksheetCreate");
  vi.doUnmock("./pasteDataRun");
  vi.doUnmock("./appendWorkspaceRun");
});

const fail = () => {
  throw new Error("network error");
};

describe("slice 30 seams: the body's chunk will not load", () => {
  it("createDerivedWorksheet reports it, returns null and creates nothing", async () => {
    vi.doMock("./derivedWorksheetCreate", fail);
    const before = useApp.getState();

    const result = await useApp.getState().createDerivedWorksheet("d1", { yOff: 1 });

    const s = useApp.getState();
    expect(result).toBeNull();
    expect(s.status).toMatch(/^Create derived worksheet failed to load: .+/);
    expect(dangerToasts()).toEqual([s.status]);
    expect(s.datasets).toBe(before.datasets);
    expect(s.history).toHaveLength(0);
  });

  it("pasteDataFromClipboard reads the clipboard, then reports the load failure and adds nothing", async () => {
    const readText = vi.fn().mockResolvedValue("x\ty\n1\t2\n");
    Object.defineProperty(navigator, "clipboard", { value: { readText }, configurable: true });
    vi.doMock("./pasteDataRun", fail);
    const before = useApp.getState();

    await useApp.getState().pasteDataFromClipboard();

    const s = useApp.getState();
    expect(readText).toHaveBeenCalledTimes(1);
    expect(s.status).toMatch(/^Paste failed to load: .+ — nothing was added$/);
    expect(dangerToasts()).toEqual([s.status]);
    expect(s.datasets).toBe(before.datasets);
    expect(s.history).toHaveLength(0);
  });

  it("appendWorkspace reports it and leaves the project and its undo stack untouched", async () => {
    vi.doMock("./appendWorkspaceRun", fail);
    const before = useApp.getState();
    const ws = { datasets: [ds("x1")], folders: [] } as unknown as LoadedWorkspace;

    await expect(useApp.getState().appendWorkspace(ws)).rejects.toThrow();

    const s = useApp.getState();
    expect(dangerToasts()).toHaveLength(1);
    expect(dangerToasts()[0]).toMatch(/^Could not load the project append: .+/);
    expect(s.datasets).toBe(before.datasets);
    expect(s.history).toHaveLength(0);
  });
});
