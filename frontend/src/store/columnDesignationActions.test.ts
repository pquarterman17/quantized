// Audit item 9: the worksheet's "Set As" (X, Y, Z, Y Error, X Error, Label,
// Disregard) writes a persisted, undoable, sanitized per-dataset designation
// map plus the channelRoles/errorRoles the plot and exports already honour.

import { beforeEach, describe, expect, it } from "vitest";

import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import type { Dataset } from "../lib/types";
import { bookDefaultHiddenChannels } from "../lib/errorbars";
import { withLiveErrorRoles } from "../lib/liveErrorRoles";
import { applyDesignation, setColumnDesignation } from "./columnDesignationActions";
import { useApp } from "./useApp";

const data = () => ({
  time: [0, 1, 2],
  values: [
    [1, 0.1, 0.2, 7, 3],
    [2, 0.1, 0.2, 8, 4],
    [3, 0.1, 0.2, 9, 5],
  ],
  labels: ["R", "dR", "dX", "Tag", "M"],
  units: ["", "", "", "", ""],
  metadata: {},
});
const ds = (extra: Partial<Dataset> = {}): Dataset => ({ id: "d1", name: "r.dat", data: data(), errorRoles: [], ...extra });

beforeEach(() => {
  useApp.setState({ datasets: [ds()], activeId: "d1", history: [], future: [], hiddenChannels: [], errKeys: {} });
});

describe("applyDesignation", () => {
  it("Y Error binds to the nearest preceding Y; X Error to the Y it follows", () => {
    let d = ds();
    d = { ...d, ...applyDesignation(d, 1, "Y-error") };
    expect(d.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    d = { ...d, ...applyDesignation(d, 2, "X-error") };
    expect(d.errorRoles).toContainEqual({ channel: 2, target: 0, axis: "x", side: "both" });
    expect(d.columnDesignations).toEqual({ 1: "Y-error", 2: "X-error" });
  });

  it("X Error with no Y before it binds to the shared X axis", () => {
    const out = applyDesignation(ds(), 0, "X-error");
    expect(out.errorRoles).toEqual([{ channel: 0, target: -1, axis: "x", side: "both" }]);
  });

  it("Label and Disregard write the matching channelRoles; Y clears them and the column's bindings", () => {
    let d = ds({ errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }] });
    d = { ...d, ...applyDesignation(d, 3, "label") };
    expect(d.channelRoles).toEqual({ 3: "label" });
    d = { ...d, ...applyDesignation(d, 4, "disregard") };
    expect(d.channelRoles).toEqual({ 3: "label", 4: "ignore" });
    d = { ...d, ...applyDesignation(d, 3, "Y") };
    expect(d.channelRoles).toEqual({ 4: "ignore" });
    // R stops being a Y: the binding that targeted it goes too.
    d = { ...d, ...applyDesignation(d, 0, "label") };
    expect(d.errorRoles).toEqual([]);
  });

  it("a Y Error with nothing before it to pair is designated but reports it unpaired", () => {
    const out = applyDesignation(ds(), 0, "Y-error");
    expect(out.paired).toBe(false);
    expect(out.errorRoles).toEqual([]);
  });
});

describe("setColumnDesignation", () => {
  it("is one undoable step that also updates the live plot", () => {
    setColumnDesignation("d1", 3, "label");
    let s = useApp.getState();
    expect(s.datasets[0].columnDesignations).toEqual({ 3: "label" });
    expect(s.datasets[0].channelRoles).toEqual({ 3: "label" });
    expect(s.hiddenChannels).toContain(3);
    expect(s.status).toBe("set Tag as Label");
    s.undo();
    s = useApp.getState();
    expect(s.datasets[0].columnDesignations).toBeUndefined();
    expect(s.datasets[0].channelRoles).toBeUndefined();
  });

  it("survives a .dwk save and reopen, sanitized on load", () => {
    setColumnDesignation("d1", 1, "Y-error");
    const saved = useApp.getState().datasets[0];
    const out = parseWorkspace(serializeWorkspace({ datasets: [saved] }));
    expect(out.datasets[0].columnDesignations).toEqual({ 1: "Y-error" });
    expect(out.datasets[0].errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    const tampered = JSON.parse(serializeWorkspace({ datasets: [saved] })) as { datasets: Record<string, unknown>[] };
    tampered.datasets[0].columnDesignations = { 1: "Y-error", 2: "nonsense", 99: "X" };
    expect(parseWorkspace(JSON.stringify(tampered)).datasets[0].columnDesignations).toEqual({ 1: "Y-error" });
  });
});

describe("an unpaired Set As error column: worksheet, plot and export agree", () => {
  // Integration review: Y Error with no Y before it has no binding to make.
  // The worksheet badge says yErr and the plot hides it as an error column;
  // the export carries the Set As map, which the writers keep as an
  // (unbound) error column (io/_column_roles.channel_designations).
  it("stays a Y-error designation, hidden from the plot, sent to the writers", () => {
    let d = ds();
    const out = applyDesignation(d, 0, "Y-error");
    expect(out.paired).toBe(false);
    d = { ...d, ...out };
    expect(d.columnDesignations).toEqual({ 0: "Y-error" });
    expect(d.errorRoles?.some((b) => b.channel === 0)).toBe(false);
    expect(bookDefaultHiddenChannels(d)).toContain(0);
    const sent = withLiveErrorRoles(d).metadata;
    expect(sent.user_column_designations).toEqual({ 0: "Y-error" });
    expect(sent.error_roles).toEqual(d.errorRoles);
  });
});

describe("an unpaired Set As error choice says so on the status line", () => {
  // Coordinator follow-up: nothing told the user the column has no Y to
  // attach to, nor what the export does with it.
  it("Y Error with no Y before it", () => {
    setColumnDesignation("d1", 0, "Y-error");
    expect(useApp.getState().status).toBe(
      "set R as Y Error — no Y before it to attach to; exported as an unbound error column",
    );
  });

  it("X Error after a secondary X", () => {
    useApp.setState({
      datasets: [ds({ columnDesignations: { 0: "X" } })],
    });
    setColumnDesignation("d1", 1, "X-error");
    expect(useApp.getState().status).toBe(
      "set dR as X Error — no Y in its X block to attach to; exported as an unbound error column",
    );
  });

  it("a paired choice keeps the plain status", () => {
    setColumnDesignation("d1", 1, "Y-error");
    expect(useApp.getState().status).toBe("set dR as Y Error");
  });
});
