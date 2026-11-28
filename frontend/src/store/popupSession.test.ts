// A popup session folds its own Applies into one undo step, but never an entry
// that something outside the popup pushed between two Applies, and never an
// entry an undo pressed mid-session already removed (plan item 44).

import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct } from "../lib/types";
import { createPopupSession } from "./popupSession";
import { useApp } from "./useApp";

const raw: DataStruct = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["m"], units: [""], metadata: {} };
const st = () => useApp.getState();
const name = () => st().datasets.find((d) => d.id === "d1")?.name;
const labels = () => st().history.map((e) => e.label);

beforeEach(() => {
  useApp.setState({ datasets: [{ id: "d1", name: "start", data: raw }], activeId: "d1", history: [], future: [] });
});

describe("popup session folding", () => {
  it("folds several Applies into one step", () => {
    const apply = createPopupSession(st, "Popup").run;
    apply(() => st().renameDataset("d1", "one"));
    apply(() => st().renameDataset("d1", "two"));
    expect(st().history).toHaveLength(1);
    st().undo();
    expect(name()).toBe("start");
  });

  it("keeps an entry pushed outside the popup between two Applies as its own step", () => {
    const apply = createPopupSession(st, "Popup").run;
    apply(() => st().renameDataset("d1", "one"));
    st().recordHistory("outside action");
    apply(() => st().renameDataset("d1", "two"));
    expect(st().history).toHaveLength(3);
    expect(labels()[1]).toBe("outside action");
    st().undo();
    expect(name()).toBe("one");
    expect(labels()).toHaveLength(2);
    st().undo();
    st().undo();
    expect(name()).toBe("start");
  });

  it("after an undo pressed mid-session, the next Apply starts a new step from the undone state", () => {
    const apply = createPopupSession(st, "Popup").run;
    apply(() => st().renameDataset("d1", "one"));
    st().undo();
    expect(name()).toBe("start");
    apply(() => st().renameDataset("d1", "two"));
    expect(st().history).toHaveLength(1);
    expect(labels()[0]).not.toBe("Popup");
    st().undo();
    expect(name()).toBe("start");
  });
});
