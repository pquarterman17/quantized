// LIBRARY_WORKBOOK_UX_PLAN PR L (L0.48/L0.49) — Collection CRUD.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";

describe("Collections CRUD slice", () => {
  beforeEach(() => {
    useApp.setState({ collections: [], history: [], future: [] });
  });

  it("addCollection saves a named query and is undoable", () => {
    const id = useApp.getState().addCollection("Hysteresis loops", "tag:mvsh");
    expect(id).not.toBeNull();
    expect(useApp.getState().collections).toEqual([{ id, name: "Hysteresis loops", query: "tag:mvsh" }]);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().collections).toEqual([]);
  });

  it("addCollection trims the name and query", () => {
    useApp.getState().addCollection("  Loops  ", "  tag:mvsh  ");
    expect(useApp.getState().collections[0]).toMatchObject({ name: "Loops", query: "tag:mvsh" });
  });

  it("a blank name is a no-op — no history entry, nothing saved", () => {
    const id = useApp.getState().addCollection("   ", "tag:x");
    expect(id).toBeNull();
    expect(useApp.getState().collections).toEqual([]);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("renameCollection updates the name and is undoable; unknown id / blank name is a no-op", () => {
    const id = useApp.getState().addCollection("Loops", "tag:mvsh")!;
    useApp.getState().renameCollection(id, "Hysteresis");
    expect(useApp.getState().collections[0]!.name).toBe("Hysteresis");
    useApp.getState().undo();
    expect(useApp.getState().collections[0]!.name).toBe("Loops");

    const before = useApp.getState().collections;
    useApp.getState().renameCollection("nope", "X");
    useApp.getState().renameCollection(id, "   ");
    expect(useApp.getState().collections).toBe(before);
  });

  it("updateCollectionQuery re-scopes the saved search without touching the name; undoable", () => {
    const id = useApp.getState().addCollection("Loops", "tag:mvsh")!;
    useApp.getState().updateCollectionQuery(id, "tag:xrd");
    expect(useApp.getState().collections[0]).toMatchObject({ name: "Loops", query: "tag:xrd" });
    useApp.getState().undo();
    expect(useApp.getState().collections[0]!.query).toBe("tag:mvsh");
  });

  it("removeCollection deletes by id and is undoable; unknown id is a no-op", () => {
    const id = useApp.getState().addCollection("Loops", "tag:mvsh")!;
    const before = useApp.getState().collections;
    useApp.getState().removeCollection("nope");
    expect(useApp.getState().collections).toBe(before);

    useApp.getState().removeCollection(id);
    expect(useApp.getState().collections).toEqual([]);
    useApp.getState().undo();
    expect(useApp.getState().collections).toHaveLength(1);
  });

  it("round-trips through save/load (.dwk persistence, L0.48/L0.49 additive)", () => {
    useApp.getState().addCollection("Loops", "tag:mvsh");
    const saved = useApp.getState().collections;
    useApp.getState().loadWorkspace({ datasets: [], collections: saved });
    expect(useApp.getState().collections).toEqual(saved);
    // Absent on an older/pre-PR-L doc — loads as none (additive, not a crash).
    useApp.getState().loadWorkspace({ datasets: [] });
    expect(useApp.getState().collections).toEqual([]);
  });
});
