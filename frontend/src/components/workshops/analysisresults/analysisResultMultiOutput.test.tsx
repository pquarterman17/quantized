// The result workspace for a reflectivity curves result (several outputs, one
// stored fit record): a deleted output, a trimmed record, and the one record
// lookup the fingerprint check and the decoded record share.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { referencedRecordSource, referencedRecordState } from "../../../lib/resultInputsRecord";
import { useApp } from "../../../store/useApp";
import { curveDatasets, savedCurves } from "../reflectivity/reflFitCurves";
import { buildChannel } from "../reflectivity/reflFitData";
import { commitReflFitOutputs, REFL_CURVES_PRODUCER } from "../reflectivity/reflFitOutputsCommit";
import { channelDigest, withFitRecord, type ReflFitRecord } from "../reflectivity/reflFitRecord";
import { fitResponse, makeRecord, xrrDataset } from "../reflectivity/reflFit.testkit";
import { REFL_RECORD_TRIMMED } from "./analysisResultPanelText";
import { liveReflectivityFit } from "./AnalysisResultRefl";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "./AnalysisResultPanel";

const st = () => useApp.getState();
let record: ReflFitRecord;
let ids: string[];

function fitted(...datasetIds: string[]): ReflFitRecord {
  const ds = datasetIds.map((id) => xrrDataset(id));
  const rec = makeRecord({}, datasetIds);
  rec.request.settings = { ...rec.request.settings, qMin: null };
  rec.request.channels.forEach((ch, i) => {
    Object.assign(ch, { rCol: 0, drCol: 1, dqCol: 2, rLabel: "Intensity", drLabel: "uncertainty", dqLabel: "resolution" });
    ch.digest = channelDigest(buildChannel(ds[i]!.data, new Set(), ch, rec.request.settings, "dr", null, "").channel);
  });
  return { ...rec, curves: savedCurves(fitResponse()) };
}

function seed(datasetIds: string[] = ["xrr"]): void {
  record = fitted(...datasetIds);
  useApp.setState({
    datasets: withFitRecord(datasetIds.map((id) => xrrDataset(id)), record), activeId: datasetIds[0], analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual", openAnalysisResultId: null,
  });
  ids = commitReflFitOutputs("add curves", REFL_CURVES_PRODUCER, record,
    curveDatasets(record.curves!, record, st().datasets, { weighting: "dr", radiation: "xray" }));
  useApp.setState({ openAnalysisResultId: st().analysisResults[0]!.id });
}

beforeEach(() => seed());

describe("a multi-output result with a deleted output", () => {
  it("reads Current while every output exists", () => {
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("reads Incomplete when a NON-primary output worksheet is deleted", () => {
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== ids.at(-1)) }));
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
  });

  it("keeps the out-of-date message when the PRIMARY output is deleted and the result is stale", () => {
    useApp.setState((s) => ({
      datasets: s.datasets.filter((d) => d.id !== ids[0]), staleDatasets: [],
      analysisResults: s.analysisResults.map((r) => ({ ...r, stale: true as const })),
    }));
    render(<AnalysisResultPanel />);
    fireTab("Diagnostics");
    expect(screen.getByText(/source changed after this output was computed/i)).toBeInTheDocument();
  });
});

function fireTab(name: string): void {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(name) }));
}

describe("a curves result whose fit record fell out of the bounded history", () => {
  beforeEach(() => {
    // A later fit trimmed the record: the sources are still there, the history no longer holds it.
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, reflFits: [] })) }));
  });

  it("does not claim the source is missing: the worksheets stand as written", () => {
    render(<AnalysisResultPanel />);
    expect(screen.getAllByText(REFL_RECORD_TRIMMED).length).toBeGreaterThan(0);
    expect(screen.queryByText(/restore one of its source worksheets/)).not.toBeInTheDocument();
    expect(screen.queryByText("Source missing")).not.toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("says so in Diagnostics, not 'missing from its source worksheets'", () => {
    render(<AnalysisResultPanel />);
    fireTab("Diagnostics");
    expect(screen.getAllByText(REFL_RECORD_TRIMMED).length).toBeGreaterThan(0);
    expect(screen.queryByText(/missing from its source worksheets/)).not.toBeInTheDocument();
  });

  it("with its source worksheets gone too it is still 'Source missing'", () => {
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => ids.includes(d.id)) }));
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Source missing")).toBeInTheDocument();
  });
});

describe("one record lookup for the fingerprint check and the decoded record", () => {
  it("both read the first source (envelope order) holding a copy with the id", () => {
    seed(["xrr", "xrr2"]);
    const result = st().analysisResults[0]!;
    const found = referencedRecordSource(result, st().datasets);
    expect(found?.datasetId).toBe("xrr");
    expect(liveReflectivityFit(result, st().datasets)?.id).toBe(record.id);
    expect(referencedRecordState(result, st().datasets)).toBe("current");
  });

  it("when the first copy is unreadable, the check and the shown record agree (neither silently takes the second)", () => {
    seed(["xrr", "xrr2"]);
    const result = st().analysisResults[0]!;
    // Corrupt only the FIRST source's copy (same id, undecodable): the fingerprint check judges it changed,
    // so the workspace withholds the record instead of showing the second copy under a verdict about the first.
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "xrr"
      ? { ...d, reflFits: (d.reflFits as { id: string }[]).map((r) => ({ id: r.id, version: 999 })) } : d) }));
    expect(referencedRecordSource(result, st().datasets)?.datasetId).toBe("xrr");
    expect(referencedRecordState(result, st().datasets)).toBe("changed");
    expect(liveReflectivityFit(result, st().datasets)).toBeNull();
  });
});
