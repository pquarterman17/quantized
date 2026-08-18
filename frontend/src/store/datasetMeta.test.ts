// LIBRARY_WORKBOOK_UX_PLAN PR L / L0.56 — batch project-metadata edit.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";
import type { Dataset } from "../lib/types";

const rawHeader = { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: { sample: "Fe3O4" } };

const ds = (id: string, extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name: `${id}.dat`,
  data: rawHeader,
  ...extra,
});

describe("batchEditDatasetMetadata", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [
        ds("d1", { tags: ["alpha"] }),
        ds("d2", { notes: "keep me", group: "keep group" }),
        ds("d3"),
      ],
      history: [],
      future: [],
    });
  });

  it("applies notes/group to only the selected ids, leaving others untouched", () => {
    useApp.getState().batchEditDatasetMetadata(["d1", "d3"], { notes: "batch note", group: "batch group" });
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "d1")?.notes).toBe("batch note");
    expect(s.datasets.find((d) => d.id === "d1")?.group).toBe("batch group");
    expect(s.datasets.find((d) => d.id === "d3")?.notes).toBe("batch note");
    // d2 was not in the selection — untouched.
    expect(s.datasets.find((d) => d.id === "d2")?.notes).toBe("keep me");
    expect(s.datasets.find((d) => d.id === "d2")?.group).toBe("keep group");
  });

  it("an explicit empty string clears notes/group; an absent field leaves it alone", () => {
    useApp.getState().batchEditDatasetMetadata(["d2"], { notes: "" });
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "d2")?.notes).toBeUndefined();
    // group field was never passed — untouched.
    expect(s.datasets.find((d) => d.id === "d2")?.group).toBe("keep group");
  });

  it("adds and removes tags across the selection, deduplicated", () => {
    useApp.getState().batchEditDatasetMetadata(["d1", "d2"], { addTags: ["beta", "alpha"], removeTags: [] });
    let s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "d1")?.tags).toEqual(["alpha", "beta"]); // no duplicate "alpha"
    expect(s.datasets.find((d) => d.id === "d2")?.tags).toEqual(["beta", "alpha"]);

    useApp.getState().batchEditDatasetMetadata(["d1"], { removeTags: ["alpha"] });
    s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "d1")?.tags).toEqual(["beta"]);
  });

  it("clearing every tag drops the field to undefined (keeps .dwk clean)", () => {
    useApp.getState().batchEditDatasetMetadata(["d1"], { removeTags: ["alpha"] });
    expect(useApp.getState().datasets.find((d) => d.id === "d1")?.tags).toBeUndefined();
  });

  it("is undoable as exactly ONE entry for the whole selection (L0.56)", () => {
    useApp.getState().batchEditDatasetMetadata(["d1", "d2", "d3"], { group: "batch group" });
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "d1")?.group).toBeUndefined();
    expect(s.datasets.find((d) => d.id === "d2")?.group).toBe("keep group");
    expect(s.datasets.find((d) => d.id === "d3")?.group).toBeUndefined();
  });

  it("a no-op patch (nothing set) records no history and mutates nothing", () => {
    const before = useApp.getState().datasets;
    useApp.getState().batchEditDatasetMetadata(["d1", "d2"], {});
    const s = useApp.getState();
    expect(s.datasets).toBe(before);
    expect(s.history).toHaveLength(0);
  });

  it("unknown ids are silently skipped, not thrown", () => {
    expect(() => useApp.getState().batchEditDatasetMetadata(["nope"], { notes: "x" })).not.toThrow();
  });

  it("NEVER rewrites the imported raw data/header — project metadata only (frozen boundary, L0.56)", () => {
    const before = useApp.getState().datasets.find((d) => d.id === "d1")!;
    useApp.getState().batchEditDatasetMetadata(["d1"], {
      notes: "n", group: "g", addTags: ["t1"], removeTags: ["nope"],
    });
    const after = useApp.getState().datasets.find((d) => d.id === "d1")!;
    // `data` (the imported DataStruct, including its raw header metadata) is
    // referentially untouched — a batch edit only ever produces a new
    // top-level Dataset object with notes/group/tags replaced.
    expect(after.data).toBe(before.data);
    expect(after.data.metadata.sample).toBe("Fe3O4");
    expect(after.raw).toBe(before.raw);
  });
});
