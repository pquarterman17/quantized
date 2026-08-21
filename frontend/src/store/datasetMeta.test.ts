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

  it("a no-op patch (nothing set) records no history, mutates nothing, and returns 0", () => {
    const before = useApp.getState().datasets;
    const returned = useApp.getState().batchEditDatasetMetadata(["d1", "d2"], {});
    const s = useApp.getState();
    expect(returned).toBe(0);
    expect(s.datasets).toBe(before);
    expect(s.history).toHaveLength(0);
  });

  it("unknown ids are silently skipped, not thrown", () => {
    expect(() => useApp.getState().batchEditDatasetMetadata(["nope"], { notes: "x" })).not.toThrow();
  });

  it("every named id already gone (deleted/trashed since capture) — zero mutation, ZERO history entries, returns 0 (adversarial-review P2)", () => {
    // The exact race LibraryDetails.tsx's batch-edit dialog is exposed to:
    // selectedIds is captured before the async askParams() dialog, so every
    // named dataset can be gone by the time the user confirms. A phantom
    // "batch edit metadata" entry here would make Ctrl+Z silently no-op.
    const before = useApp.getState().datasets;
    const returned = useApp.getState().batchEditDatasetMetadata(["gone1", "gone2"], { notes: "x", group: "y", addTags: ["t"] });
    const s = useApp.getState();
    expect(returned).toBe(0);
    expect(s.datasets).toBe(before); // referentially untouched
    expect(s.history).toHaveLength(0);
  });

  it("a mixed selection (2 live + 1 already-gone) applies to only the live ones, ONE history entry, returns the live count", () => {
    const returned = useApp.getState().batchEditDatasetMetadata(["d1", "gone", "d3"], { group: "batch group" });
    const s = useApp.getState();
    expect(returned).toBe(2);
    expect(s.history).toHaveLength(1);
    expect(s.datasets.find((d) => d.id === "d1")?.group).toBe("batch group");
    expect(s.datasets.find((d) => d.id === "d3")?.group).toBe("batch group");
    expect(s.datasets.find((d) => d.id === "d2")?.group).toBe("keep group"); // untouched
  });

  it("a live selection with an effective patch returns the applied count", () => {
    const returned = useApp.getState().batchEditDatasetMetadata(["d1", "d3"], { notes: "batch note" });
    expect(returned).toBe(2);
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

// P2-2 (Sol's Day-6 audit): the single-row actions must retrofit the SAME
// "compute the effective patch first, bail before recordHistory on a no-op"
// shape batchEditDatasetMetadata already has above -- a missing id, a blank
// tag, a duplicate tag, an absent tag, or an unchanged value must never push
// a phantom undo entry that Ctrl+Z silently no-ops on.
describe("single-row dataset-meta actions never record a phantom no-op undo entry (P2-2)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [
        ds("d1", { tags: ["alpha"], notes: "existing note", group: "existing group" }),
      ],
      history: [],
      future: [],
    });
  });

  it("setDatasetNotes: missing id records no history", () => {
    useApp.getState().setDatasetNotes("nope", "x");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("setDatasetNotes: unchanged value records no history", () => {
    useApp.getState().setDatasetNotes("d1", "existing note");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("setDatasetNotes: a genuine change records exactly one history entry", () => {
    useApp.getState().setDatasetNotes("d1", "new note");
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().datasets.find((d) => d.id === "d1")?.notes).toBe("new note");
  });

  it("addDatasetTag: missing id records no history", () => {
    useApp.getState().addDatasetTag("nope", "beta");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("addDatasetTag: blank tag records no history", () => {
    useApp.getState().addDatasetTag("d1", "   ");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("addDatasetTag: duplicate tag records no history", () => {
    useApp.getState().addDatasetTag("d1", "alpha");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("addDatasetTag: a genuine new tag records exactly one history entry", () => {
    useApp.getState().addDatasetTag("d1", "beta");
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().datasets.find((d) => d.id === "d1")?.tags).toEqual(["alpha", "beta"]);
  });

  it("removeDatasetTag: missing id records no history", () => {
    useApp.getState().removeDatasetTag("nope", "alpha");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("removeDatasetTag: absent tag records no history", () => {
    useApp.getState().removeDatasetTag("d1", "not-there");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("removeDatasetTag: a genuine removal records exactly one history entry", () => {
    useApp.getState().removeDatasetTag("d1", "alpha");
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().datasets.find((d) => d.id === "d1")?.tags).toBeUndefined();
  });

  it("setDatasetGroup: missing id records no history", () => {
    useApp.getState().setDatasetGroup("nope", "x");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("setDatasetGroup: unchanged value records no history", () => {
    useApp.getState().setDatasetGroup("d1", "existing group");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("setDatasetGroup: a genuine change records exactly one history entry", () => {
    useApp.getState().setDatasetGroup("d1", "new group");
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().datasets.find((d) => d.id === "d1")?.group).toBe("new group");
  });
});
