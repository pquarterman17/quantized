// The redaction guarantee, exercised end-to-end through the REAL collector and
// the REAL store rather than a hand-built snapshot.
//
// `lib/diagnostics.test.ts` proves the builder cannot emit secrets it is
// handed. That is necessary but not sufficient: the collector decides what to
// hand over, so a field added carelessly there would leak past a green builder
// test. This loads a store full of the things that actually matter in this
// app — an unpublished sample name, a collaborator's compound as a column
// label, an absolute project path, real measurements — and asserts none of it
// reaches the text a user copies.

import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct, Dataset } from "../lib/types";
import { collectDiagnostics, diagnosticsText } from "./diagnostics";
import { useApp } from "./useApp";

const SECRET_NAME = "UNPUBLISHED-LaSrMnO3-batch7";
const SECRET_LABEL = "Moment_collabCompound";
const SECRET_PATH = "/home/paige/Projects/embargoed/run7.dat";
const SECRET_VALUE = 1234.56789;

const data: DataStruct = {
  time: [1, 2, 3],
  values: [[SECRET_VALUE], [2], [3]],
  labels: [SECRET_LABEL],
  units: ["emu"],
  metadata: { sourcePath: SECRET_PATH },
};

beforeEach(() => {
  const ds: Dataset = {
    id: "d1",
    name: SECRET_NAME,
    data,
    formulas: [{ name: "F1", expr: "A*2" }],
    corrections: { smooth: 3 },
    sourcePath: SECRET_PATH,
  } as Dataset;
  useApp.setState({
    datasets: [ds],
    activeId: "d1",
    folders: [],
    workbooks: [],
    stageTab: "plot",
  });
  try {
    localStorage.setItem("qz.secretSlot", JSON.stringify({ path: SECRET_PATH }));
  } catch {
    /* private mode — the slot assertions below tolerate absence */
  }
});

describe("collected diagnostics never carry project content", () => {
  it("omits the dataset name, column label, path and measured value", () => {
    const text = diagnosticsText();
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain(SECRET_LABEL);
    expect(text).not.toContain(SECRET_PATH);
    expect(text).not.toContain(String(SECRET_VALUE));
  });

  it("names a stored slot but never its contents", () => {
    const text = diagnosticsText();
    // The key may appear; what it holds must not.
    expect(text).not.toContain("embargoed");
  });

  it("still reports the shape that makes a bug report useful", () => {
    const snap = collectDiagnostics();
    expect(snap.workspace.datasets).toBe(1);
    expect(snap.workspace.largestDatasetRows).toBe(3);
    expect(snap.workspace.largestDatasetColumns).toBe(1);
    expect(snap.workspace.datasetsWithFormulas).toBe(1);
    expect(snap.workspace.datasetsWithCorrections).toBe(1);
    expect(snap.workspace.stageTab).toBe("plot");
  });

  it("survives an empty workspace without emitting Infinity or NaN", () => {
    // Math.max() of an empty list is -Infinity — a classic way for a "safe"
    // report to render nonsense on a fresh session.
    useApp.setState({ datasets: [] });
    const snap = collectDiagnostics();
    expect(snap.workspace.largestDatasetRows).toBe(0);
    expect(snap.workspace.largestDatasetColumns).toBe(0);
    const text = diagnosticsText();
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("NaN");
  });
});
