import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TemplatesSection from "./TemplatesSection";
import { makeStep } from "../../../lib/pipeline";
import { loadTemplates, saveTemplate, serializeTemplate, toTemplate, type AnalysisTemplate } from "../../../lib/template";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

const { uploadMock, fitMock, modelsMock, emitMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  fitMock: vi.fn(),
  modelsMock: vi.fn(),
  emitMock: vi.fn(),
}));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  uploadFile: uploadMock,
  fitModel: fitMock,
  reportEmit: emitMock,
}));
// listFitModels moved to lib/api/curvefit.ts (R8 bundle-diet pass) — mock
// it at its real import path.
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  listFitModels: modelsMock,
}));

const DATA: DataStruct = {
  time: [1, 2, 3],
  values: [[2], [4], [6]],
  labels: ["I"],
  units: [""],
  metadata: {},
};

const TEMPLATE = toTemplate(
  "linear flow",
  [
    makeStep("import", "Import a.dat", 'qz.import("a.dat")', { name: "a.dat" }),
    makeStep("expression", "Add column d", 'qz.addColumn("d", "A * 2")', {
      name: "d",
      expr: "A * 2",
    }),
    makeStep("fit", "Fit Linear", 'qz.fit("Linear")', { model: "Linear" }),
  ],
  ["slope", "intercept", "R2"],
);

const file = (name: string) => new File(["x,y\n1,2\n"], name, { type: "text/csv" });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useApp.setState({
    datasets: [],
    activeId: null,
    macroSteps: [],
    macroRecording: false,
    pipelineRunning: false,
    reports: [],
    openReportId: null,
  });
});

describe("TemplatesSection", () => {
  it("saves the current pipeline as a template with auto-declared outputs", async () => {
    modelsMock.mockResolvedValue({
      models: [
        { name: "Linear", category: "", paramNames: ["slope", "intercept"], nParams: 2, p0: [], lb: [], ub: [] },
      ],
    });
    useApp.setState({
      macroSteps: [makeStep("fit", "Fit Linear", 'qz.fit("Linear")', { model: "Linear" })],
    });
    render(<TemplatesSection />);
    fireEvent.change(screen.getByPlaceholderText("save as…"), { target: { value: "my flow" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("qz.analysisTemplates")!)).toHaveLength(1),
    );
    const saved = JSON.parse(localStorage.getItem("qz.analysisTemplates")!)[0];
    expect(saved.outputs).toEqual(["slope", "intercept", "R2"]);
  });

  it("loads a template's steps into the pipeline", () => {
    saveTemplate(TEMPLATE);
    render(<TemplatesSection />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "linear flow" } });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    const steps = useApp.getState().macroSteps;
    expect(steps.map((s) => s.kind)).toEqual(["import", "expression", "fit"]);
  });

  it("batch: N files → per-file reports + one summary sheet; a corrupt file flags, never crashes", async () => {
    saveTemplate(TEMPLATE);
    uploadMock.mockImplementation((f: File) =>
      f.name === "bad.dat"
        ? Promise.reject(new Error("unparseable"))
        : Promise.resolve(DATA),
    );
    fitMock.mockResolvedValue({ params: [2, 0], errors: [0.1, 0.1], R2: 0.999 });
    emitMock.mockResolvedValue({ report: { title: "t", sections: [] } });

    render(<TemplatesSection />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "linear flow" } });
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [file("a.dat"), file("bad.dat"), file("c.dat")] },
    });

    await waitFor(() => {
      const summary = useApp.getState().datasets.find((d) => d.name.includes("summary"));
      expect(summary).toBeTruthy();
    });
    const s = useApp.getState();
    const summary = s.datasets.find((d) => d.name.includes("summary"))!;
    // one row per input file, columns = declared outputs
    expect(summary.data.time).toEqual([1, 2, 3]);
    expect(summary.data.labels).toEqual(["slope", "intercept", "R2"]);
    expect(summary.data.values[0]).toEqual([2, 0, 0.999]);
    // the corrupt file yields a flagged NaN row, not a crash
    expect(Number.isNaN(summary.data.values[1][0])).toBe(true);
    expect(summary.data.metadata.failures).toEqual([
      expect.stringContaining("bad.dat"),
    ]);
    // per-file reports landed for the two good files
    expect(s.reports).toHaveLength(2);
    expect(s.reports[0].name).toBe("linear flow — a.dat");
    // and the good files' datasets carry the expression column
    const a = s.datasets.find((d) => d.name === "a.dat")!;
    expect(a.data.labels).toContain("d");
  });

  // Finding #4: Apply and Batch both toggle the SAME `pipelineRunning` flag
  // while they run — either one already in flight must disable the other.
  it("disables Apply and Batch while the other is running", () => {
    saveTemplate(TEMPLATE);
    render(<TemplatesSection />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "linear flow" } });
    expect(screen.getByRole("button", { name: "Apply…" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Batch…" })).not.toBeDisabled();

    act(() => useApp.setState({ pipelineRunning: true }));
    expect(screen.getByRole("button", { name: "Apply…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Batch…" })).toBeDisabled();

    act(() => useApp.setState({ pipelineRunning: false }));
    expect(screen.getByRole("button", { name: "Apply…" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Batch…" })).not.toBeDisabled();
  });

  // Finding #8: importing over an existing name must never move its
  // revision backwards or leave it repeating.
  it("import: keeps the local revision when identical, bumps past both when the definition differs", async () => {
    const local = { ...TEMPLATE, revision: 3 };
    saveTemplate(local);
    render(<TemplatesSection />);
    const importInput = document.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;

    // Same definition, a LOWER file revision: the local one is kept, not overwritten.
    const identicalFile = new File([serializeTemplate({ ...local, revision: 1 })], "same.json", { type: "application/json" });
    fireEvent.change(importInput, { target: { files: [identicalFile] } });
    await waitFor(() => expect(loadTemplates().find((t) => t.name === local.name)?.revision).toBe(3));

    // A genuinely different definition (an extra step), file revision behind local: bump past BOTH.
    const different: AnalysisTemplate = {
      ...local,
      revision: 2,
      steps: [...local.steps, makeStep("expression", "extra", "", { name: "extra", expr: "A" })],
    };
    const differentFile = new File([serializeTemplate(different)], "different.json", { type: "application/json" });
    fireEvent.change(importInput, { target: { files: [differentFile] } });
    await waitFor(() => expect(loadTemplates().find((t) => t.name === local.name)?.revision).toBe(4)); // max(3, 2) + 1
  });
});
