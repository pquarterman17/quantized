// Red-first tests for PR L slice 2's persisted Details column selection.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";

describe("libraryDetailsColumns slice", () => {
  beforeEach(() => {
    useApp.setState({
      visibleDetailsColumns: ["type", "location", "dimensions", "dataType", "source", "modified", "tags"],
    });
  });

  it("defaults to today's original seven columns", () => {
    expect(useApp.getState().visibleDetailsColumns).toEqual([
      "type", "location", "dimensions", "dataType", "source", "modified", "tags",
    ]);
  });

  it("toggleVisibleDetailsColumn adds an off column", () => {
    useApp.getState().toggleVisibleDetailsColumn("sample");
    expect(useApp.getState().visibleDetailsColumns).toContain("sample");
  });

  it("toggleVisibleDetailsColumn removes an on column", () => {
    useApp.getState().toggleVisibleDetailsColumn("type");
    expect(useApp.getState().visibleDetailsColumns).not.toContain("type");
  });

  it("is excluded from undo (a view preference, not a data edit)", () => {
    useApp.setState({ history: [], future: [] });
    const before = useApp.getState().visibleDetailsColumns;
    useApp.getState().toggleVisibleDetailsColumn("sample");
    expect(useApp.getState().history).toHaveLength(0);
    // Sanity: the toggle DID change state (this isn't a no-op silently
    // passing for the wrong reason).
    expect(useApp.getState().visibleDetailsColumns).not.toEqual(before);
  });
});
