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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, Dataset } from "../lib/types";
import { useAutosaveStatus } from "./autosaveStatus";
import { collectDiagnostics, diagnosticsText } from "./diagnostics";
import { beginOp, endOp } from "./pendingOps";
import { useRecoveryChoice, type RecoveryPrompt } from "./recoveryChoice";
import { resetNotificationMarks, toast } from "./toasts";
import { useApp } from "./useApp";

const SECRET_NAME = "UNPUBLISHED-LaSrMnO3-batch7";
const SECRET_LABEL = "Moment_collabCompound";
const SECRET_PATH = "/home/paige/Projects/embargoed/run7.dat";
const SECRET_VALUE = 1234.56789;
/** A TEXT cell, not just a number — a categorical column holds sample codes
 *  and operator initials, which redaction by "it's all numbers anyway" misses. */
const SECRET_CELL_TEXT = "operator-Q-embargoed-code";

const data: DataStruct = {
  time: [1, 2, 3],
  values: [[SECRET_VALUE, SECRET_CELL_TEXT], [2, "b"], [3, "c"]] as unknown as number[][],
  labels: [SECRET_LABEL, "condition"],
  units: ["emu", ""],
  metadata: { sourcePath: SECRET_PATH },
};

/** No test in this file should reach the network: the collector probes
 *  `/api/health` for the backend version, and an unmocked fetch would make
 *  the result depend on whatever is listening on the test machine. */
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ok", app: "quantized", version: "9.9.9-test" }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNotificationMarks();
  useAutosaveStatus.setState({ health: { savedAt: null, error: null, count: 0 } });
  useRecoveryChoice.setState({ pending: null });
});

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
    localStorage.clear();
    // A vetted slot (its name is on the allowlist) and an unvetted one whose
    // KEY carries project content — the shape a future `qz.figure.<title>`
    // would take.
    localStorage.setItem("qz.prefs", JSON.stringify({ theme: "dark" }));
    localStorage.setItem(`qz.figure.${SECRET_NAME}`, JSON.stringify({ path: SECRET_PATH }));
  } catch {
    /* private mode — the slot assertions below tolerate absence */
  }
});

describe("collected diagnostics never carry project content", () => {
  it("omits the dataset name, column label, path and both kinds of cell value", async () => {
    const text = await diagnosticsText();
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain(SECRET_LABEL);
    expect(text).not.toContain(SECRET_PATH);
    expect(text).not.toContain(String(SECRET_VALUE));
    expect(text).not.toContain(SECRET_CELL_TEXT);
    // Not even the DIRECTORY part of the path, which is the half that names a
    // project, a collaborator, or an embargo.
    expect(text).not.toContain("/home/paige/Projects/embargoed");
    expect(text).not.toContain("embargoed");
    // And not the basename either: this bundle withholds file names outright
    // rather than offering an opt-in, so `run7.dat` is as absent as the rest.
    expect(text).not.toContain("run7.dat");
  });

  it("still describes THAT dataset by shape, so the exclusion test is not vacuous", async () => {
    // The load-bearing companion to the assertions above: a builder that
    // emitted nothing at all would pass every one of them. The same text that
    // is asserted to contain none of the secrets must be asserted to contain
    // what was DERIVED from the very dataset holding them.
    const text = await diagnosticsText();
    expect(text).toContain("3 rows × 2 columns");
    expect(text).toMatch(/datasets\s+1/);
    expect(text).toMatch(/with formulas\s+1/);
  });

  it("names a stored slot but never its contents", async () => {
    const text = await diagnosticsText();
    expect(text).toContain("qz.prefs");
    expect(text).not.toContain("embargoed");
  });

  it("refuses to print the NAME of a slot the allowlist does not vet", async () => {
    // The namespace prefix is not a safety property: a composed key makes the
    // KEY itself project content. Before the allowlist this section printed
    // every `qz.` key verbatim, so this exact string reached the bundle.
    const text = await diagnosticsText();
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain("qz.figure.");
  });

  it("still counts unvetted slots, so a quota problem stays diagnosable", () => {
    // Suppressing the name must not suppress the evidence — the section
    // exists to answer "what is filling my storage?".
    const snap = collectDiagnostics();
    expect(snap.otherStorage.slots).toBe(1);
    expect(snap.otherStorage.bytes).toBeGreaterThan(0);
    expect(snap.storage.map((e) => e.key)).toEqual(["qz.prefs"]);
  });

  it("reports a build identity rather than an anonymous report", async () => {
    const snap = collectDiagnostics();
    // Under vitest the vite `define` supplies the real values; the point of
    // the assertion is that neither field is empty or `undefined`, which is
    // what an unwired global would produce.
    expect(snap.build.version).toBeTruthy();
    expect(snap.build.sha).toBeTruthy();
    expect(await diagnosticsText()).not.toContain("undefined");
  });

  it("still reports the shape that makes a bug report useful", () => {
    const snap = collectDiagnostics();
    expect(snap.workspace.datasets).toBe(1);
    expect(snap.workspace.largestDatasetRows).toBe(3);
    expect(snap.workspace.largestDatasetColumns).toBe(2);
    expect(snap.workspace.datasetsWithFormulas).toBe(1);
    expect(snap.workspace.datasetsWithCorrections).toBe(1);
    expect(snap.workspace.stageTab).toBe("plot");
  });

  it("survives an empty workspace without emitting Infinity or NaN", async () => {
    // Math.max() of an empty list is -Infinity — a classic way for a "safe"
    // report to render nonsense on a fresh session.
    useApp.setState({ datasets: [] });
    const snap = collectDiagnostics();
    expect(snap.workspace.largestDatasetRows).toBe(0);
    expect(snap.workspace.largestDatasetColumns).toBe(0);
    const text = await diagnosticsText();
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("NaN");
  });
});

describe("session health reaches the bundle as state, never as message text", () => {
  it("records that errors fired, and how recently, without their wording", async () => {
    // The triage question a support report must answer is "were errors firing
    // around this?" — which the count answers. The wording is what cannot come
    // along: every one of these messages embeds project content.
    toast(`re-import "${SECRET_NAME}" failed: ${SECRET_PATH}`, "danger");
    toast("saved", "ok");
    const text = await diagnosticsText();
    expect(text).toMatch(/notifications\s+2/);
    expect(text).toMatch(/of those, errors\s+1/);
    expect(text).toMatch(/last error\s+\d+ s ago/);
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain(SECRET_PATH);
  });

  it("reports a failing autosave without its reason string", async () => {
    // The reason is free text from the storage engine or a call site that was
    // never asked to keep it publishable; the banner in the status bar is
    // where the user reads it and chooses to quote it.
    useAutosaveStatus.setState({
      health: { savedAt: null, error: `quota exceeded writing ${SECRET_PATH}`, count: 2 },
    });
    const text = await diagnosticsText();
    expect(text).toMatch(/autosave\s+FAILING/);
    expect(text).toMatch(/generations kept\s+2/);
    expect(text).not.toContain(SECRET_PATH);
    expect(text).not.toContain("quota exceeded");
  });

  it("reports an unanswered recovery prompt and work still in flight", async () => {
    useRecoveryChoice.setState({ pending: { datasetCount: 4 } as unknown as RecoveryPrompt });
    // A pendingOp's LABEL is "Importing 3/19: <file>…" — project content, and
    // the reason only the count crosses over.
    const op = beginOp(`Importing 1/1: ${SECRET_PATH}…`);
    try {
      const text = await diagnosticsText();
      expect(text).toMatch(/recovery prompt open\s+yes/);
      expect(text).toMatch(/operations in flight\s+1/);
      expect(text).not.toContain(SECRET_PATH);
    } finally {
      endOp(op);
    }
  });

  it("names the backend that answered the health probe", async () => {
    expect(await diagnosticsText()).toMatch(/backend\s+quantized 9\.9\.9-test/);
  });

  it("says 'unreachable' rather than failing when no backend answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const text = await diagnosticsText();
    expect(text).toMatch(/backend\s+unreachable/);
    // The rest of the report must still be there — an offline backend is a
    // thing to REPORT, not a reason to have no report.
    expect(text).toContain("# Quantized diagnostics");
  });
});
