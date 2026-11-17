// UX9-I: one Ctrl+Z straight after File > Open must not silently empty the
// project. An open into an EMPTY session records no undo step (there is
// nothing to go back to); an open over real work keeps its step -- the safety
// net for an accidental replace -- and undoing it says so, with a Redo.
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import type { LoadedWorkspace } from "./workspace";
import { replaceWorkspace } from "./openWorkspaceReplace";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";

const ds = (id: string): Dataset => ({
  id, name: `${id}.csv`, data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});
const opened = (): LoadedWorkspace => ({ datasets: [ds("opened")], activeId: "opened", migrationWarnings: [] }) as unknown as LoadedWorkspace;
const ids = () => useApp.getState().datasets.map((d) => d.id);
const lastToast = () => useToasts.getState().toasts.at(-1);

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  useToasts.setState({ toasts: [] });
});

describe("Undo straight after Open workspace", () => {
  it("an open into an empty session is not undoable: Ctrl+Z leaves the project there", () => {
    replaceWorkspace(useApp.getState, opened());
    expect(useApp.getState().history).toHaveLength(0);
    useApp.getState().undo();
    expect(ids()).toEqual(["opened"]);
  });

  it("drops a stale redo stack, which belongs to the workspace that is gone", () => {
    useApp.getState().recordHistory("add");
    useApp.setState({ datasets: [ds("x")] });
    useApp.getState().undo(); // empty again, with "add" on the redo stack
    expect(useApp.getState().future).toHaveLength(1);
    replaceWorkspace(useApp.getState, opened());
    useApp.getState().redo();
    expect(ids()).toEqual(["opened"]);
  });

  it("an open over real work stays undoable, and the Undo toasts a working Redo", () => {
    useApp.setState({ datasets: [ds("mine")], activeId: "mine" });
    replaceWorkspace(useApp.getState, opened());
    expect(useApp.getState().history.at(-1)?.label).toBe("open workspace");
    useApp.getState().undo();
    expect(ids()).toEqual(["mine"]);
    const t = lastToast();
    expect(t?.msg).toMatch(/Undid open workspace/);
    expect(t?.action?.label).toBe("Redo");
    t!.action!.onClick();
    expect(ids()).toEqual(["opened"]);
  });

  it("the toast's Redo refuses once another edit moved the stack", () => {
    useApp.setState({ datasets: [ds("mine")], activeId: "mine" });
    replaceWorkspace(useApp.getState, opened());
    useApp.getState().undo();
    const redo = lastToast()!.action!;
    useApp.getState().recordHistory("edit"); // clears the redo stack
    redo.onClick();
    expect(ids()).toEqual(["mine"]);
    expect(lastToast()?.msg).toMatch(/Can't redo/);
  });
});
