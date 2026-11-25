// DOE as saved results (owner decision 2026-11-25): a generated design and a
// two-level effects analysis are separate results, each with the book's
// Copy / Send to report / Open as worksheet; generation still adds the design
// worksheet; a Library reopen of a design refills the setup form.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { doeEffects, doeFractions, doeGenerate } from "../../../lib/api/doe";
import { designData } from "../../../lib/doeTestData";
import { DOE_DESIGN_RESULT, DOE_EFFECTS_RESULT } from "../../../lib/toolResultKinds";
import { EFFECTS, SETUP } from "../../../lib/toolResultKinds.testkit";
import { useDoeStore } from "../../../store/doe";
import { useToolResultRequest } from "../../../store/toolResultRequest";
import { useApp } from "../../../store/useApp";
import DoePanel from "./DoePanel";

vi.mock("../../../lib/api/doe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/doe")>()),
  doeGenerate: vi.fn(), doeFractions: vi.fn(), doeEffects: vi.fn(),
}));
const { reportInline, copyTextMock, sent } = vi.hoisted(() => ({ reportInline: vi.fn(), copyTextMock: vi.fn(), sent: [] as [string, number][] }));
vi.mock("../../../store/analysisResultActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../store/analysisResultActions")>()),
  sendAnalysisInlineTableToReport: reportInline,
}));
vi.mock("../../../lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/clipboard")>()), copyText: copyTextMock,
}));

class MockResizeObserver { observe(): void {} disconnect(): void {} }

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  sent.length = 0;
  reportInline.mockImplementation(async (id: string, index: number) => { sent.push([id, index]); return true; });
  copyTextMock.mockResolvedValue(true);
  vi.mocked(doeFractions).mockResolvedValue({ k: 3, fractions: [], center_points: { ccd: 6, ccd_fractional: 7, box_behnken: 3 } });
  const seeded = designData();
  vi.mocked(doeGenerate).mockResolvedValue({ dataset: { ...seeded, metadata: { ...seeded.metadata, doe: { ...(seeded.metadata!.doe as object), randomized: true, seed: 42 } } } });
  vi.mocked(doeEffects).mockResolvedValue(EFFECTS);
  useApp.setState({ datasets: [], activeId: null, selection: null, analysisResults: [], history: [], future: [], status: "", staleDatasets: [], staleFits: [] });
  useDoeStore.setState({ open: true });
  useToolResultRequest.setState({ timeSeries: null, doe: null, profiler: null });
});

const region = (name: string) => screen.getByRole("region", { name });

describe("DOE design result", () => {
  it("saves the generated design with its settings and the seed the server used, and offers the book's actions", async () => {
    render(<DoePanel />);
    fireEvent.change(screen.getByLabelText("Number of factors"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate worksheet" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    const book = await waitFor(() => region("Design result"));
    fireEvent.click(within(book).getByRole("button", { name: "Save result" }));
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(1));
    const saved = useApp.getState().analysisResults[0]!;
    expect(saved).toMatchObject({ producer: { id: DOE_DESIGN_RESULT }, sources: [{ datasetId: useApp.getState().datasets[0]!.id }],
      parameters: { recipe: { setup: { design: "full_factorial", k: 2, seed: "42" } }, algorithm: { id: "doe-full_factorial", version: 1 } } });
    expect(saved.tables!.map((t) => t.title)).toEqual(["Design summary", "Factors", "Model terms", "Design runs"]);
    expect(within(book).getByRole("button", { name: "Save result" })).toBeDisabled();
    fireEvent.click(within(book).getByRole("button", { name: "Send to report: Factors" }));
    await waitFor(() => expect(sent).toEqual([[saved.id, 1]]));
    fireEvent.click(within(book).getByRole("button", { name: "Copy table: Design runs" }));
    await waitFor(() => expect(useApp.getState().status).toMatch(/^copied /));
    fireEvent.click(within(book).getByRole("button", { name: "Open as worksheet: Design runs" }));
    await waitFor(() => expect(useApp.getState().datasets.some((d) => d.name.endsWith("Design runs (frozen)"))).toBe(true));
  });

  it("does not save a design whose generation settings were not recorded here (fail closed)", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "DOE", data: designData() }], activeId: "d1" });
    render(<DoePanel />);
    const save = within(region("Design result")).getByRole("button", { name: "Save result" });
    expect(save).toBeDisabled();
    expect(save.getAttribute("title")).toMatch(/generation settings are not recorded/);
  });

  it("refills the setup form from a Library reopen", async () => {
    render(<DoePanel />);
    act(() => useToolResultRequest.getState().request({ doe: { setup: { ...SETUP, seed: "42", randomize: true }, designColumns: ["A"] } }));
    await waitFor(() => expect(screen.getByLabelText("Factor 1 high")).toHaveValue("15"));
    expect(screen.getByLabelText("Number of factors")).toHaveValue("2");
    expect(screen.getByLabelText("Seed (blank = new)")).toHaveValue("42");
    expect(useToolResultRequest.getState().doe).toBeNull();
  });
});

describe("DOE effects result", () => {
  it("is a separate result of the filled design, with the book's actions", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "DOE", data: designData([5, 11, 6, 12]) }], activeId: "d1" });
    render(<DoePanel />);
    const book = await waitFor(() => region("Effects result"));
    expect(within(book).getByRole("img", { name: "Half-normal plot of effects" })).toBeInTheDocument();
    fireEvent.click(within(book).getByRole("button", { name: "Save result" }));
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(1));
    const saved = useApp.getState().analysisResults[0]!;
    expect(saved).toMatchObject({ producer: { id: DOE_EFFECTS_RESULT }, sources: [{ datasetId: "d1" }],
      parameters: { recipe: { responseLabel: "Y" }, algorithm: { id: "doe-effects-lenth" }, inputs: { items: [{ includedRows: 4 }] } } });
    expect(saved.tables![0]!.rows[0]).toEqual(["A", 6, 6, 1.15, 8, "yes"]);
    fireEvent.click(within(book).getByRole("button", { name: "Send to report: Effects" }));
    await waitFor(() => expect(sent).toEqual([[saved.id, 0]]));
    fireEvent.click(within(book).getByRole("button", { name: "Open as worksheet: Lenth summary" }));
    await waitFor(() => expect(useApp.getState().datasets.some((d) => d.name.endsWith("Lenth summary (frozen)"))).toBe(true));
  });
});
