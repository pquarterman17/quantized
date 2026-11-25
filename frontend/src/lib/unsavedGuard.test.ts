// The beforeunload guard (owner decision 2026-11-25): present only while the
// pref is on AND there are unsaved changes.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { installUnsavedGuard, unsavedWarningActive } from "./unsavedGuard";
import { setWorkflowPrefs } from "./workflowPrefsEdit";

/** Fire a cancelable beforeunload; true when a listener asked to block it. */
function blocked(): boolean {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

const ds = { id: "a", name: "a", data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } };
let dispose: () => void;

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ datasets: [], currentProject: null, browserFileName: null, projectDirty: false });
  dispose = installUnsavedGuard();
});
afterEach(() => dispose());

describe("unsaved-changes guard", () => {
  it("no listener on a clean, empty workspace", () => {
    expect(blocked()).toBe(false);
  });

  it("blocks once a named project is dirty, and clears when it is saved", () => {
    useApp.setState({ currentProject: { name: "p", path: "/p.dwk" }, projectDirty: true });
    expect(blocked()).toBe(true);
    useApp.setState({ projectDirty: false });
    expect(blocked()).toBe(false);
  });

  it("an unnamed workspace with data counts as unsaved (the title bar's rule)", () => {
    useApp.setState({ datasets: [ds] });
    expect(blocked()).toBe(true);
    useApp.setState({ datasets: [] });
    expect(blocked()).toBe(false);
  });

  it("pref off: never blocks, even when dirty; turning it on arms it live", () => {
    setWorkflowPrefs({ confirmUnsavedClose: false });
    useApp.setState({ currentProject: { name: "p", path: "/p.dwk" }, projectDirty: true });
    expect(blocked()).toBe(false);
    expect(unsavedWarningActive()).toBe(false);
    setWorkflowPrefs({ confirmUnsavedClose: true });
    expect(blocked()).toBe(true);
  });

  it("the disposer removes the listener", () => {
    useApp.setState({ datasets: [ds] });
    expect(blocked()).toBe(true);
    dispose();
    expect(blocked()).toBe(false);
  });
});
