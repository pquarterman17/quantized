// UX-C: the open project (identity + lock) follows the history entries that swap
// the whole workspace — Remove all and open — through ANY undo/redo, so a save
// can never write one project's data into another project's file.

import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runRemoveAll } from "../commands/fileCommandsLazy";
import type { Dataset } from "../lib/types";
import { followProjectHistory } from "./projectFollowsHistory";
import { useProjectLock } from "./projectLock";
import { noteProjectLockRelease } from "./projectLockLifecycle";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn().mockResolvedValue(true) }));

const mk = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});
const A = { name: "A", path: "/p/A.dwk" };
const B = { name: "B", path: "/p/B.dwk" };
const removeAll = () => runRemoveAll(() => useApp.getState());
const proj = () => useApp.getState().currentProject;
const ids = () => useApp.getState().datasets.map((d) => d.id);

/** What replaceWorkspaceImpl does: the history entry is pushed while the old
 *  project is still current, then the workspace and identity are swapped. */
function openProject(p: typeof A, dataset: string) {
  followProjectHistory();
  useApp.getState().recordHistory("open workspace");
  useApp.setState({ datasets: [mk(dataset)], activeId: dataset, selectedIds: [dataset] });
  useApp.getState().setCurrentProject(p);
}
const edits = (n: number) => { for (let i = 0; i < n; i++) useApp.getState().recordHistory(`edit ${i}`); };

async function undoClick() {
  await waitFor(() => expect(useToasts.getState().toasts.some((t) => t.action?.label === "Undo")).toBe(true));
  useToasts.getState().toasts.find((t) => t.action?.label === "Undo")!.action!.onClick();
}

afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [mk("a")], activeId: "a", selectedIds: ["a"], history: [], future: [], trash: [] });
  useApp.getState().setCurrentProject(A);
  await useProjectLock.getState().openProject(A.path);
});

describe("Undo of Remove all", () => {
  it("brings back the data, the project identity and a held lock", async () => {
    await removeAll();
    expect(ids()).toEqual([]);
    expect(proj()).toBeNull();
    expect(useProjectLock.getState().path).toBeNull();
    await undoClick();
    expect(ids()).toEqual(["a"]);
    expect(proj()).toEqual(A);
    expect(useProjectLock.getState().path).toBe(A.path);
    await waitFor(() => expect(useProjectLock.getState().status).toBe("held-by-me"));
  });

  it("restores read-only, and says so, when another instance took the project meanwhile", async () => {
    await removeAll();
    vi.spyOn(useProjectLock.getState().provider, "tryAcquire").mockResolvedValue({ acquired: false, record: null, unverifiable: true });
    await undoClick();
    expect(ids()).toEqual(["a"]);
    await waitFor(() => expect(useToasts.getState().toasts.some((t) => /opened read-only/.test(t.msg))).toBe(true));
    expect(useProjectLock.getState().status).not.toBe("held-by-me");
  });

  it("Redo detaches the project again: a save has no project to overwrite with an empty workspace", async () => {
    await removeAll();
    await undoClick();
    await waitFor(() => expect(useProjectLock.getState().status).toBe("held-by-me"));
    useApp.getState().redo();
    expect(ids()).toEqual([]);
    expect(proj()).toBeNull();
    expect(useProjectLock.getState().path).toBeNull();
  });

  it("Edit > Undo re-attaches it too (marked unsaved) and the toast then says already undone", async () => {
    await removeAll();
    useApp.getState().undo();
    expect(proj()).toEqual(A);
    expect(useApp.getState().projectDirty).toBe(true);
    await waitFor(() => expect(useProjectLock.getState().status).toBe("held-by-me"));
    await undoClick();
    expect(useToasts.getState().toasts.some((t) => t.msg === "Already undone.")).toBe(true);
  });

  it("the toast refuses the WHOLE Undo, restoring nothing, when another project is open", async () => {
    await removeAll();
    useApp.getState().setCurrentProject(B);
    await undoClick();
    expect(ids()).toEqual([]);
    expect(proj()?.name).toBe("B");
    expect(useToasts.getState().toasts.some((t) => /Can't undo — another project/.test(t.msg))).toBe(true);
  });

  it("is not refused in the browser build (the autosave slot's synthetic lock path is not a project)", async () => {
    useApp.getState().setCurrentProject(null);
    useProjectLock.setState({ path: "qz://browser-autosave-session" });
    await removeAll();
    await undoClick();
    expect(ids()).toEqual(["a"]);
    expect(useToasts.getState().toasts.some((t) => /Can't undo/.test(t.msg))).toBe(false);
  });
});

describe("Undo of an open follows the project too (pre-existing hole)", () => {
  it("A with data -> open B -> Undo restores A's data AND A's identity, never leaving B's name on A's data", async () => {
    openProject(B, "b");
    expect(proj()).toEqual(B);
    useApp.getState().undo();
    expect(ids()).toEqual(["a"]);
    expect(proj()).toEqual(A); // Ctrl+S now targets A's own file, not B's
    expect(useProjectLock.getState().path).toBe(A.path);
    useApp.getState().redo();
    expect(ids()).toEqual(["b"]);
    expect(proj()).toEqual(B);
  });

  it("undoing an open that replaced an UNNAMED session detaches the project (Save As, never overwrite B)", () => {
    useApp.getState().setCurrentProject(null);
    openProject(B, "b");
    useApp.getState().undo();
    expect(ids()).toEqual(["a"]);
    expect(proj()).toBeNull();
    expect(useProjectLock.getState().path).toBeNull();
  });
});

describe("a fast undo of an open waits for the open flow's background release of the project it left", () => {
  it("re-acquires only after the (delayed) release lands, so the late release cannot delete the new lock", async () => {
    const provider = useProjectLock.getState().provider;
    const heldToken = useProjectLock.getState().record?.token ?? "";
    const realRelease = provider.release.bind(provider);
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    vi.spyOn(provider, "release").mockImplementation(async (path, token) => { await gate; return realRelease(path, token); });
    openProject(B, "b");
    // what the open flow does in the background: release A's lock (slowly) while B's is reserved
    noteProjectLockRelease(provider.release(A.path, heldToken));
    useProjectLock.setState({ path: B.path, status: "held-by-me", record: null });

    const acquire = vi.spyOn(provider, "tryAcquire");
    useApp.getState().undo(); // Ctrl+Z straight after the open
    expect(proj()).toEqual(A);
    await new Promise((r) => setTimeout(r, 30)); // let any (wrongly) un-gated acquisition run
    expect(acquire).not.toHaveBeenCalled(); // nothing acquired while A's old record is still on disk

    open();
    await waitFor(() => expect(useProjectLock.getState().status).toBe("held-by-me"));
    const rec = await provider.read(A.path);
    expect(rec?.token).toBe(useProjectLock.getState().record?.token); // the NEW record survived the late release
  });
});

describe("history eviction cannot misalign the records (keys are entry seqs, not positions)", () => {
  it("5a: open A -> Remove all -> open B -> Remove all -> 48 edits -> undo back: B's project, never A's", async () => {
    await removeAll(); // RA1 (before = A)
    openProject(B, "b"); // before = none
    await removeAll(); // RA2 (before = B)
    edits(48); // 51 entries > depth 50: RA1 is evicted
    for (let i = 0; i < 48; i++) useApp.getState().undo();
    useApp.getState().undo(); // RA2
    expect(ids()).toEqual(["b"]);
    expect(proj()).toEqual(B); // Ctrl+S would write b into B's file
    expect(proj()?.path).not.toBe(A.path);
  });

  it("5b: an unnamed session's Remove all attaches NO project when undone after eviction", async () => {
    await removeAll(); // A gone; session now unnamed
    useApp.setState({ datasets: [mk("c")], activeId: "c", selectedIds: ["c"] });
    await removeAll(); // before = none
    edits(49); // evicts the first Remove all
    for (let i = 0; i < 49; i++) useApp.getState().undo();
    useApp.getState().undo();
    expect(ids()).toEqual(["c"]);
    expect(proj()).toBeNull(); // never A
  });
});

describe("Undo and the Trash", () => {
  it("a dataset restored by an Undo toast leaves the Trash (no duplicate to Restore later)", async () => {
    const { requestDatasetRemoval } = await import("../lib/datasetRemoval");
    useApp.setState({ confirmRemove: false });
    requestDatasetRemoval(["a"]);
    expect(useApp.getState().trash.some((e) => e.kind === "dataset" && e.dataset.id === "a")).toBe(true);
    await undoClick();
    expect(ids()).toEqual(["a"]);
    expect(useApp.getState().trash.some((e) => e.kind === "dataset" && e.dataset.id === "a")).toBe(false);
  });
});
