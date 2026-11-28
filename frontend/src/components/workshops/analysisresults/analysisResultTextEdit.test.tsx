// A text cell is part of what a saved result read. A result that grouped or
// labelled by a text column must show "Out of date" once that text changes,
// and "Current" again after Undo. There is no worksheet text-cell editor yet
// (text columns are read-only in the grid), so the edit below is made the way
// the cell-edit actions make theirs: record history, then replace the sheet's
// `data` (store/cellEditRun.ts). The panel is the real one.

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { Dataset } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "./AnalysisResultPanel";
import { useApp } from "../../../store/useApp";

const sheet = (id: string, groups: string[] | null): Dataset => ({
  id, name: id,
  data: {
    time: [0, 1, 2], values: [[1], [2], [3]], labels: ["val"], units: [""],
    metadata: groups ? { text_columns: { grp: groups } } : {},
  },
});

const withResult = (ds: Dataset, over: Partial<AnalysisResult> = {}): AnalysisResult => ({
  version: 1, id: "res", name: "Test by grp",
  producer: { id: "statistical-test", label: "Statistical test", version: 1 },
  sources: [{ datasetId: ds.id, role: "input" }], outputs: [], warnings: [], createdAt: "2026-11-28T00:00:00Z",
  parameters: { testId: "anova" }, sourceFingerprint: analysisDataFingerprint(ds), ...over,
});

/** The edit: one text cell changes, nothing numeric does. */
function editText(id: string, row: number, text: string): void {
  useApp.getState().recordHistory("text edit");
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => {
      if (d.id !== id) return d;
      const cells = [...((d.data.metadata?.["text_columns"] as Record<string, string[]>)["grp"])];
      cells[row] = text;
      return { ...d, data: { ...d.data, metadata: { ...d.data.metadata, text_columns: { grp: cells } } } };
    }),
  }));
}

const grouped = sheet("g", ["a", "a", "b"]);
const plain = sheet("p", null);
const other = sheet("o", ["x", "y", "z"]);

function open(result: AnalysisResult): void {
  useApp.setState({
    datasets: [grouped, plain, other], activeId: "g", analysisResults: [result], openAnalysisResultId: result.id,
    staleDatasets: [], staleFits: [], history: [], future: [], recalcMode: "manual",
  });
}

beforeEach(() => open(withResult(grouped)));

describe("text edits and saved results", () => {
  it("a result grouped by a text column is Out of date after a text edit, Current again after Undo", () => {
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    act(() => editText("g", 2, "a"));
    expect(screen.getByText("Out of date")).toBeInTheDocument();
    act(() => useApp.getState().undo());
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("stays Out of date through save and reopen", () => {
    editText("g", 2, "a");
    const doc = serializeWorkspace({ ...useApp.getState() });
    useApp.getState().loadWorkspace(parseWorkspace(doc));
    useApp.setState({ openAnalysisResultId: "res" });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Out of date")).toBeInTheDocument();
  });

  it("a text edit on a sheet the result did not read leaves it Current", () => {
    render(<AnalysisResultPanel />);
    act(() => editText("o", 0, "q"));
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("a result saved before text was hashed stays Current on load", () => {
    const legacy = withResult(grouped, { sourceFingerprint: analysisDataFingerprint(grouped).replace(/~t[0-9a-f]{8}/, "") });
    expect(legacy.sourceFingerprint).not.toBe(analysisDataFingerprint(grouped));
    open(legacy);
    const doc = serializeWorkspace({ ...useApp.getState() });
    useApp.getState().loadWorkspace(parseWorkspace(doc));
    useApp.setState({ openAnalysisResultId: "res" });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
  });
});

describe("analysisDataFingerprint text segment", () => {
  it("is absent for a sheet without text, so those results keep their fingerprint", () => {
    expect(analysisDataFingerprint(plain)).toMatch(/^[0-9a-f]{16}:[0-9a-f]{8}$/);
  });

  it("changes with one text cell, a column name, or either sidecar spelling", () => {
    const base = analysisDataFingerprint(grouped);
    const edited = analysisDataFingerprint(sheet("g", ["a", "a", "c"]));
    const renamed = { ...grouped, data: { ...grouped.data, metadata: { text_columns: { other: ["a", "a", "b"] } } } };
    const origin = { ...grouped, data: { ...grouped.data, metadata: { origin_text_columns: { grp: ["a", "a", "b"] } } } };
    expect(new Set([base, edited, analysisDataFingerprint(renamed), analysisDataFingerprint(origin)]).size).toBe(4);
  });

  it("survives the JSON round trip", () => {
    const again = JSON.parse(JSON.stringify(grouped)) as Dataset;
    expect(analysisDataFingerprint(again)).toBe(analysisDataFingerprint(grouped));
  });
});
