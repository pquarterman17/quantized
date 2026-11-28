// The RAW source fingerprint (linked outputs, a fit's freshness stamp) sees text
// cells. There is no worksheet text-cell editor, so the edit below is made the
// way store/cellEditRun.ts makes its edits (replace the sheet's `data`; the store
// keeps `metadata` immutable). Records are judged through the real load path
// (parseWorkspace + loadWorkspace -> staleFits / staleDatasets).

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "../components/workshops/analysisresults/AnalysisResultPanel";

import { committedOutputResult } from "./committedOutput";
import { dataFingerprint } from "./dataFingerprint";
import { fitAnalysisResult } from "./fitAnalysisResultLive";
import { rawSourceFingerprint } from "./textFingerprint";
import type { AnalysisResult } from "./analysisResult";
import type { Dataset, FitSpec } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { useApp } from "../store/useApp";

const mk = (id: string, cells: string[] | null): Dataset => ({
  id, name: id,
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["v"], units: [""], metadata: cells ? { text_columns: { grp: cells } } : {} },
});
const spec = { model: "linear", params: [1, 0], fittedAt: "2026-11-28T00:00:00Z", yKey: 0 } as unknown as FitSpec;
const out = mk("out", null);

function withFit(src: Dataset): Dataset { return { ...src, fitSpec: spec }; }

function setState(datasets: Dataset[], results: AnalysisResult[]): void {
  useApp.setState({ datasets, analysisResults: results, staleDatasets: [], staleFits: [], history: [], future: [] });
}
/** One text cell changes; nothing numeric does. */
function editText(id: string, row: number, text: string): void {
  useApp.getState().recordHistory("text edit");
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => {
      if (d.id !== id) return d;
      const cells = [...(d.data.metadata!["text_columns"] as Record<string, string[]>)["grp"]!];
      cells[row] = text;
      return { ...d, data: { ...d.data, metadata: { ...d.data.metadata, text_columns: { grp: cells } } } };
    }),
  }));
}
function reload(): void {
  useApp.getState().loadWorkspace(parseWorkspace(serializeWorkspace({ ...useApp.getState() })));
}
const linked = (src: Dataset, over: Partial<AnalysisResult> = {}): AnalysisResult => ({
  ...committedOutputResult({ id: "lnk", producer: { id: "p", label: "P", version: 1 }, source: src, output: out, key: "k", settings: {} }), ...over,
});

beforeEach(() => setState([], []));

describe("raw source fingerprint text segment", () => {
  it("is exactly the numeric hash for a sheet without text, and changes with one text cell", () => {
    expect(rawSourceFingerprint(mk("p", null).data)).toBe(dataFingerprint(mk("p", null).data));
    const a = rawSourceFingerprint(mk("g", ["a", "a", "b"]).data);
    expect(a).toMatch(/^[0-9a-f]{16}~t[0-9a-f]{8}$/);
    expect(rawSourceFingerprint(mk("g", ["a", "a", "c"]).data)).not.toBe(a);
    expect(rawSourceFingerprint(JSON.parse(JSON.stringify(mk("g", ["a", "a", "b"]))).data)).toBe(a);
  });
});

/** A saved file whose text changed after the results were stamped (edited
 *  elsewhere, or by a text writer that did not touch the recalc graph). */
function loadWithEditedText(): void {
  const doc = serializeWorkspace({ ...useApp.getState() });
  expect(doc).toContain('"a","a","b"');
  useApp.getState().loadWorkspace(parseWorkspace(doc.replace('"a","a","b"', '"a","a","a"')));
}

describe("a text edit reaches the raw-fingerprint consumers", () => {
  it("a curve fit is stale on load after its sheet's text changed", () => {
    const g = withFit(mk("g", ["a", "a", "b"]));
    setState([g], [fitAnalysisResult(g, spec)]);
    loadWithEditedText();
    expect(useApp.getState().staleFits).toEqual(["g"]);
  });

  it("a linked output is stale on load after its source's text changed", () => {
    const g = mk("g", ["a", "a", "b"]);
    setState([g, out], [linked(g)]);
    loadWithEditedText();
    expect(useApp.getState().staleDatasets).toContain("out");
  });

  it("the result panel shows a fit stale after a live text edit (no recalc mark)", () => {
    const g = withFit(mk("g", ["a", "a", "b"]));
    setState([g], [fitAnalysisResult(g, spec)]);
    useApp.setState({ activeId: "g", openAnalysisResultId: `analysis-fit-g`, recalcMode: "manual" });
    const { unmount } = render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    act(() => editText("g", 2, "a"));
    expect(screen.getAllByText("Out of date").length).toBeGreaterThan(0);
    unmount();
  });

  it("an unedited sheet stays current", () => {
    const g = withFit(mk("g", ["a", "a", "b"]));
    setState([g, out], [fitAnalysisResult(g, spec), linked(g)]);
    reload();
    expect(useApp.getState().staleFits).toEqual([]);
    expect(useApp.getState().staleDatasets).toEqual([]);
  });
});

describe("records saved before text was hashed are not flagged on load", () => {
  it("a legacy (numeric-only) fit and linked-output fingerprint stay current on a sheet with text", () => {
    const g = withFit(mk("g", ["a", "a", "b"]));
    const legacy = dataFingerprint(g.data);
    expect(legacy).not.toBe(rawSourceFingerprint(g.data));
    setState([g, out], [
      { ...fitAnalysisResult(g, spec), sourceFingerprint: legacy },
      linked(g, { sourceFingerprint: legacy }),
    ]);
    // Parse the stored values as they are (no save-side restamp).
    useApp.getState().loadWorkspace(parseWorkspace(serializeWorkspace({ ...useApp.getState() })));
    expect(useApp.getState().staleFits).toEqual([]);
    expect(useApp.getState().staleDatasets).toEqual([]);
  });
});
