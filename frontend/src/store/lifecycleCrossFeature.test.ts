// Integration review (lane IR, 2026-11-22): cross-feature scenarios of the
// analysis-result lifecycle that no single PR's tests covered. Each drives the
// real store: the shared commit (lane RL), its reopen/Replace (lane RO), stale
// marking from row state and Undo (#839/#841), the Signal Processing
// "Use excluded/filtered rows" option (#846) and the save/reopen freshness
// stamp. Each bug scenario failed before its fix; the save/reopen scenario is
// coverage of the combined round trip (it passed as found).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { analysisDataFingerprint, stampAnalysisResults } from "../lib/analysisResultFreshness";
import { staleAnalysisOutputs } from "../lib/analysisResultStaleLoad";
import type { SignalCorrectionRecipe } from "../lib/signalRecipe";
import type { Dataset, DataStruct } from "../lib/types";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  applyCorrections: vi.fn(async ({ dataset }: { dataset: DataStruct }) => structuredClone(dataset)),
}));
import { applyCorrections } from "../lib/api";
import { commitAnalysisOutput, type AnalysisOutputCommit } from "./analysisOutputCommit";
import { commitComputedOutput } from "./commitComputedOutput";
import { createSignalWorksheetFromApp } from "./signalWorksheetCommand";
import { useApp } from "./useApp";

const data = (values: number[], labels = ["y"]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => labels.map(() => v)), labels, units: labels.map(() => ""), metadata: {},
});
const SOURCE: Dataset = { id: "src", name: "Film", data: data([1, 2, 3, 4]) };
const src = () => useApp.getState().datasets.find((d) => d.id === "src")!;
const byId = (id: string) => useApp.getState().datasets.find((d) => d.id === id);

function editSource(values: number[]): void {
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "src" ? { ...d, data: data(values) } : d)) }));
  useApp.getState().touchDataset("src");
}

beforeEach(() => {
  vi.mocked(applyCorrections).mockClear();
  useApp.setState({
    datasets: [SOURCE], activeId: "src", analysisResults: [], history: [], future: [], selection: null,
    staleDatasets: [], staleFits: [], recalcMode: "manual", status: "",
  });
});

describe("a committed output that keeps a derivedFrom link (Curie–Weiss) and the recalc pass", () => {
  // Lane RL4 committed Curie–Weiss through the shared contract but kept its
  // `derivedFrom` link; the recalc pass let any held committed output with
  // `derivedFrom` through, and re-derived it as a plain derived worksheet:
  // the source's own data overwrote the χ / fit table and the stale mark cleared.
  function commitCurieWeiss(): string {
    const outcome = commitComputedOutput({
      producer: { id: "curie-weiss", label: "Curie–Weiss", version: 1 },
      sources: [{ id: "src", computedOn: analysisDataFingerprint(src()) }],
      settings: { molarMass: 100 },
      name: "Film (Curie–Weiss)",
      data: data([7, 7, 7, 7], ["chi", "1/chi", "fit"]),
      derivedFrom: { datasetId: "src", pipeline: "curie-weiss" },
    });
    if (outcome.kind !== "created") throw new Error("setup");
    return outcome.outputId;
  }

  it("stays stale with its fitted table after a recalculation pass", async () => {
    const outputId = commitCurieWeiss();
    const fitted = byId(outputId)!.data;
    editSource([5, 6, 7, 8]);
    expect(useApp.getState().staleDatasets).toContain(outputId);
    await useApp.getState().recalcNow();
    expect(byId(outputId)!.data).toBe(fitted);
    expect(useApp.getState().staleDatasets).toContain(outputId);
  });

  it("a committed output with corrections of its own re-applies them but stays stale on a source change", async () => {
    const outcome = commitAnalysisOutput({
      producer: { id: "surface-fit", label: "Surface fit", version: 1 }, sourceId: "src",
      computedOn: analysisDataFingerprint(src()), settings: { model: "Plane" },
      output: () => ({ name: "Film (fit)", data: data([9, 9, 9, 9]) }),
    });
    if (outcome.kind !== "created") throw new Error("setup");
    const own = byId(outcome.outputId)!;
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === own.id ? { ...d, raw: own.data, corrections: { smoothEnabled: true } } : d)),
    }));
    editSource([5, 6, 7, 8]);
    expect(useApp.getState().staleDatasets).toContain(own.id);
    await useApp.getState().recalcNow();
    // Its own corrections cannot bring it up to date with the changed source.
    expect(useApp.getState().staleDatasets).toContain(own.id);
  });
});

describe("Undo of a Replace of a stale committed output (reopen + stale + undo)", () => {
  const PRODUCER = { id: "ellipse-fit", label: "Ellipse fit", version: 1 };
  const request = (fill: number, replace?: string): AnalysisOutputCommit => ({
    producer: PRODUCER, sourceId: "src", computedOn: analysisDataFingerprint(src()), settings: { geometric: true },
    output: (s) => ({ name: `${s.name} (fit ${fill})`, data: data([fill, fill, fill, fill]) }),
    ...(replace ? { replace } : {}),
  });

  it("the restored old output is stale in the session exactly as after a save and reopen", () => {
    const first = commitAnalysisOutput(request(1));
    if (first.kind !== "created") throw new Error("setup");
    editSource([4, 5, 6, 7]); // the output goes stale
    expect(useApp.getState().staleDatasets).toEqual([first.outputId]);
    expect(commitAnalysisOutput(request(2, first.resultId)).kind).toBe("replaced");
    expect(useApp.getState().staleDatasets).toEqual([]);

    useApp.getState().undo(); // old (stale) data and envelope back
    const s = useApp.getState();
    // What a save + reopen of this very state derives ...
    const reopened = staleAnalysisOutputs(stampAnalysisResults(s.analysisResults, s.datasets, s.staleDatasets), s.datasets);
    expect(reopened).toEqual([first.outputId]);
    // ... is what the live session says (the Library's stale badge reads it).
    expect(s.staleDatasets).toEqual([first.outputId]);

    useApp.getState().redo(); // the replaced (current) output again
    expect(useApp.getState().analysisResults[0].stale).toBeUndefined();
    expect(useApp.getState().staleDatasets).toEqual([]);
    useApp.getState().undo();
    expect(useApp.getState().staleDatasets).toEqual([first.outputId]);
  });

  it("an Undo of something else (a rename) leaves a stale output stale", () => {
    const first = commitAnalysisOutput(request(1));
    if (first.kind !== "created") throw new Error("setup");
    editSource([4, 5, 6, 7]);
    useApp.getState().recordHistory("rename result");
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => ({ ...r, name: "Renamed" })) }));
    useApp.getState().undo();
    expect(useApp.getState().staleDatasets).toEqual([first.outputId]);
  });
});

describe("Signal Processing with excluded/filtered rows left out: a row-state edit while it runs", () => {
  const recipe: SignalCorrectionRecipe = {
    kind: "signal-correction", version: 1, operation: "Smooth", xUnit: "",
    channels: [{ index: 0, label: "y", unit: "" }],
    params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
    inputRows: "analysis-view",
  };

  function holdCorrections(): { entered: Promise<void>; release: () => void } {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(applyCorrections).mockImplementationOnce(async ({ dataset }) => {
      entered();
      await gate;
      return structuredClone(dataset);
    });
    return { entered: started, release };
  }

  it("Create refuses: the output would be computed on the old analysis view yet read as current", async () => {
    const held = holdCorrections();
    const pending = createSignalWorksheetFromApp("src", recipe);
    await held.entered;
    useApp.getState().toggleRowExcluded("src", 1); // the analysis view changes mid-run
    held.release();
    expect(await pending).toBeNull();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["src"]);
    expect(useApp.getState().analysisResults).toEqual([]);
  });

  it("a linked recompute refuses and leaves the output stale", async () => {
    const id = await createSignalWorksheetFromApp("src", recipe);
    expect(id).toBeTruthy();
    useApp.getState().toggleRowExcluded("src", 0);
    expect(useApp.getState().staleDatasets).toEqual([id]);
    const held = holdCorrections();
    const pass = useApp.getState().recalcNow();
    await held.entered;
    useApp.getState().toggleRowExcluded("src", 2); // a second edit lands during the pass
    held.release();
    await pass;
    expect(useApp.getState().staleDatasets).toEqual([id]);
  });
});

describe("save and reopen of a project with committed and linked outputs", () => {
  it("keeps a committed output replaceable, its staleness, and an analysis-view linked output current", async () => {
    const OTHER: Dataset = { id: "other", name: "Other", data: data([1, 2, 3, 4]), excludedRows: [3] };
    useApp.setState({ datasets: [SOURCE, OTHER] });
    const linked = await createSignalWorksheetFromApp("other", {
      kind: "signal-correction", version: 1, operation: "Smooth", xUnit: "",
      channels: [{ index: 0, label: "y", unit: "" }],
      params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
      inputRows: "analysis-view",
    });
    const committed = commitAnalysisOutput({
      producer: { id: "ellipse-fit", label: "Ellipse fit", version: 1 }, sourceId: "src",
      computedOn: analysisDataFingerprint(src()), settings: { geometric: true },
      output: () => ({
        name: "Film (fit)",
        data: { ...data([1, Number.NaN, 3, -0]), metadata: { x_column_name: "x", x_column_unit: "mm", fit: { r2: 0.5 } } },
      }),
    });
    if (committed.kind !== "created" || !linked) throw new Error("setup");
    const { parseWorkspace, serializeWorkspace } = await import("../lib/workspace");
    const { planReopen } = await import("../lib/committedOutputReopen");
    const s = useApp.getState();
    const reopened = parseWorkspace(serializeWorkspace({
      datasets: s.datasets, analysisResults: s.analysisResults, staleDatasets: s.staleDatasets, recalcMode: "manual",
    }));
    expect(reopened.staleDatasets ?? []).toEqual([]);
    const result = reopened.analysisResults!.find((r) => r.id === committed.resultId)!;
    const plan = planReopen(result, reopened.datasets);
    expect(plan.ok && plan.replaceBlocked).toBeNull();
    expect(plan.ok && plan.notice).toBeNull();
  });
});

describe("a row-state edit while an unrelated recalculation pass runs", () => {
  // The engine drops every touchDataset during a pass (so the pass's own writes
  // never re-mark). Exclusions mark committed outputs through touchDataset since
  // #839, so a committed output whose source was edited mid-pass stayed "Current".
  it("still marks a committed output of the edited source stale", async () => {
    const OTHER: Dataset = { id: "other", name: "Other", data: data([1, 2, 3, 4]) };
    useApp.setState({ datasets: [SOURCE, OTHER] });
    const linked = await createSignalWorksheetFromApp("other", {
      kind: "signal-correction", version: 1, operation: "Smooth", xUnit: "",
      channels: [{ index: 0, label: "y", unit: "" }],
      params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
    });
    expect(linked).toBeTruthy();
    const committed = commitAnalysisOutput({
      producer: { id: "surface-fit", label: "Surface fit", version: 1 }, sourceId: "src",
      computedOn: analysisDataFingerprint(src()), settings: { model: "Plane" },
      output: () => ({ name: "Film (fit)", data: data([9, 9, 9, 9]) }),
    });
    if (committed.kind !== "created") throw new Error("setup");
    useApp.setState({ staleDatasets: [linked!] }); // the linked sheet is due for a recompute

    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(applyCorrections).mockImplementationOnce(async ({ dataset }) => {
      entered();
      await gate;
      return structuredClone(dataset);
    });
    const pass = useApp.getState().recalcNow();
    await started;
    useApp.getState().toggleRowExcluded("src", 1); // the committed output's source view changes
    release();
    await pass;
    expect(useApp.getState().staleDatasets).toContain(committed.outputId);
  });
});
