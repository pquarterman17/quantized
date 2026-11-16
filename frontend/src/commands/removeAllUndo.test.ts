// UX-C: Undo of "Remove all" restores the workspace AND the open project
// (identity + a real lock acquisition), and a dataset it brings back leaves the Trash.

import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
import { useProjectLock } from "../store/projectLock";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { runRemoveAll } from "./fileCommandsLazy";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn().mockResolvedValue(true) }));

const mk = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});
const PROJECT = { name: "run1", path: "/proj/run1.dwk" };

async function undoClick() {
  await waitFor(() => expect(useToasts.getState().toasts.some((t) => t.action?.label === "Undo")).toBe(true));
  useToasts.getState().toasts.find((t) => t.action?.label === "Undo")!.action!.onClick();
}

beforeEach(async () => {
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [mk("a")], activeId: "a", selectedIds: ["a"], history: [], future: [], trash: [] });
  useApp.getState().setCurrentProject(PROJECT);
  await useProjectLock.getState().openProject(PROJECT.path);
});

describe("Undo of Remove all", () => {
  it("brings back the data, the project identity and a held lock", async () => {
    await runRemoveAll(() => useApp.getState());
    expect(useApp.getState().datasets).toHaveLength(0);
    expect(useApp.getState().currentProject).toBeNull();
    expect(useProjectLock.getState().path).toBeNull();

    await undoClick();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a"]);
    expect(useApp.getState().currentProject).toEqual(PROJECT);
    expect(useProjectLock.getState().path).toBe(PROJECT.path); // reserved synchronously
    await waitFor(() => expect(useProjectLock.getState().status).toBe("held-by-me")); // really re-acquired
  });

  it("restores read-only, and says so, when another instance took the project meanwhile", async () => {
    await runRemoveAll(() => useApp.getState());
    const provider = useProjectLock.getState().provider;
    vi.spyOn(provider, "tryAcquire").mockResolvedValue({ acquired: false, record: null, unverifiable: true });
    await undoClick();
    expect(useApp.getState().datasets).toHaveLength(1);
    await waitFor(() => expect(useToasts.getState().toasts.some((t) => /restored read-only/.test(t.msg))).toBe(true));
    expect(useProjectLock.getState().status).not.toBe("held-by-me");
  });
});

describe("Undo and the Trash", () => {
  it("a dataset restored by Undo leaves the Trash (no duplicate to Restore later)", async () => {
    const { requestDatasetRemoval } = await import("../lib/datasetRemoval");
    useApp.setState({ confirmRemove: false });
    requestDatasetRemoval(["a"]);
    expect(useApp.getState().trash.some((e) => e.kind === "dataset" && e.dataset.id === "a")).toBe(true);
    await undoClick();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a"]);
    expect(useApp.getState().trash.some((e) => e.kind === "dataset" && e.dataset.id === "a")).toBe(false);
  });
});
