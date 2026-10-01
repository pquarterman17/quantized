// Undo coverage for the report / legacy figure-doc library (undo audit):
//
//  1. `addReport` — every workshop's "→ Report" — is its OWN undo step.
//     Before, it recorded nothing, so Ctrl+Z after a send reverted the
//     PREVIOUS edit and deleted the report with it. The send-figure path
//     (lib/sendFigureToReport.ts) still lands as exactly one step; its own
//     specs in lib/sendFigureToReport.test.ts pin that for both targets.
//  2. `removeReport` / `removeFigureDoc` follow the dataset model
//     (store/removeDatasets.ts's `removeDatasetsWithTrash`): record an undo
//     step, THEN capture to trash, THEN remove. Undo brings the item back
//     while its trash entry stays; restoring that entry later is a no-op
//     that only consumes it (store/trashRestore.ts's "came back some other
//     way" guard). Before, the delete recorded nothing, so undoing an OLDER
//     edit resurrected the deleted item behind the user's back.
//
// Every spec is do → undo → compare against the state captured before "do".

import { beforeEach, describe, expect, it } from "vitest";

import type { FigureDoc } from "../lib/figuredoc";
import type { ReportSheet } from "../lib/report";
import { snapshotOf } from "./historySnapshot";
import { trashEntryId } from "./trash";
import { useApp } from "./useApp";

const sheet = (title = "fit"): ReportSheet => ({ title, sections: [] });

const fdoc = (id: string): FigureDoc => ({
  id,
  name: id,
  datasetId: null,
  config: {
    xKey: null, yKeys: null, xScale: "linear", yScale: "linear", title: "", xLabel: "", yLabel: "",
    style: "screen", fmt: "png", dpi: 300, overrides: null, seriesStyles: null,
  },
  live: false,
});

beforeEach(() => {
  useApp.setState({
    datasets: [], activeId: null, worksheetId: null, selectedIds: [],
    reports: [], openReportId: null, figureDocs: [], figureDocSeed: null,
    trash: [], status: "", history: [], future: [], macroSteps: [], macroRecording: false,
  });
});

const app = () => useApp.getState();
const labels = () => app().history.map((h) => h.label);

describe("addReport is its own undo step", () => {
  it("do → undo restores the library exactly; the PREVIOUS edit survives", () => {
    app().addReport("older", sheet("O"));
    const olderId = app().reports[0].id;
    useApp.setState({ history: [], future: [] });
    app().renameReport(olderId, "renamed"); // the previous, unrelated edit
    const before = snapshotOf(app());

    app().addReport("peak fit", sheet("P"), null);
    expect(labels()).toEqual(["rename report", "add report"]);

    app().undo();
    expect(snapshotOf(app())).toEqual(before);
    expect(app().reports.map((r) => r.name)).toEqual(["renamed"]);
    expect(labels()).toEqual(["rename report"]);

    app().redo();
    expect(app().reports.map((r) => r.name)).toEqual(["renamed", "peak fit"]);
  });
});

describe("removeReport mirrors dataset delete + trash", () => {
  function twoReportsWithOlderEdit(): { a: string; b: string } {
    app().addReport("a", sheet("A"));
    app().addReport("b", sheet("B"));
    const [a, b] = app().reports.map((r) => r.id);
    useApp.setState({ history: [], future: [] });
    app().renameReport(a, "a2"); // the older edit
    return { a, b };
  }

  it("records one undo step; undo restores the report and NOT the older edit", () => {
    const { b } = twoReportsWithOlderEdit();
    const before = snapshotOf(app());
    app().removeReport(b);
    expect(labels()).toEqual(["rename report", "delete report"]);
    expect(app().trash.map(trashEntryId)).toEqual([`report:${b}`]);

    app().undo();
    expect(snapshotOf(app())).toEqual(before);
    expect(app().reports.map((r) => r.name)).toEqual(["a2", "b"]);
    // Like a dataset: the trash entry stays until restored or purged.
    expect(app().trash.map(trashEntryId)).toEqual([`report:${b}`]);
  });

  it("delete → undo older edit → restore from trash leaves exactly one copy", async () => {
    const { b } = twoReportsWithOlderEdit();
    app().removeReport(b);
    app().undo(); // the delete
    app().undo(); // the older rename
    expect(app().reports.map((r) => r.name)).toEqual(["a", "b"]);

    const result = await app().restoreFromTrash(`report:${b}`);
    expect(result).toEqual({ ok: true });
    expect(app().reports.filter((r) => r.id === b)).toHaveLength(1);
    expect(app().trash).toEqual([]);
  });

  it("restore after a plain delete brings it back once and consumes the entry", async () => {
    const { b } = twoReportsWithOlderEdit();
    app().removeReport(b);
    await app().restoreFromTrash(`report:${b}`);
    expect(app().reports.map((r) => r.id).filter((id) => id === b)).toHaveLength(1);
    expect(app().trash).toEqual([]);
  });

  it("an unknown id records nothing", () => {
    app().removeReport("nope");
    expect(labels()).toEqual([]);
  });
});

describe("removeFigureDoc mirrors dataset delete + trash", () => {
  function twoDocsWithOlderEdit(): void {
    app().addFigureDoc(fdoc("f1"));
    app().addFigureDoc(fdoc("f2"));
    useApp.setState({ history: [], future: [] });
    app().renameFigureDoc("f1", "f1b"); // the older edit
  }

  it("records one undo step; undo restores the doc and NOT the older edit", () => {
    twoDocsWithOlderEdit();
    const before = snapshotOf(app());
    app().removeFigureDoc("f2");
    expect(labels()).toEqual(["rename figure", "delete figure"]);

    app().undo();
    expect(snapshotOf(app())).toEqual(before);
    expect(app().figureDocs.map((f) => f.name)).toEqual(["f1b", "f2"]);
    expect(app().trash.map(trashEntryId)).toEqual(["figureDoc:f2"]);
  });

  it("delete → undo older edit → restore from trash leaves exactly one copy", async () => {
    twoDocsWithOlderEdit();
    app().removeFigureDoc("f2");
    app().undo();
    app().undo();
    expect(app().figureDocs.map((f) => f.name)).toEqual(["f1", "f2"]);

    expect(await app().restoreFromTrash("figureDoc:f2")).toEqual({ ok: true });
    expect(app().figureDocs.filter((f) => f.id === "f2")).toHaveLength(1);
    expect(app().trash).toEqual([]);
  });

  it("an unknown id records nothing", () => {
    app().removeFigureDoc("nope");
    expect(labels()).toEqual([]);
  });
});
