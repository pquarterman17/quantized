// The palette-only deep-link commands: each one SEEDS an existing dialog
// rather than re-implementing it.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAppActions } from "../appCommands";
import type { Action } from "../store/commands";
import { useSignalOperationSeed } from "../store/signalOperationSeed";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { buildDiscoveryCommands } from "./discoveryCommands";

type Field = { key: string };
const mocks = vi.hoisted(() => ({ ask: vi.fn<(title: string, fields: { key: string }[]) => Promise<null>>(), reveal: vi.fn() }));
vi.mock("../store/paramDialog", () => ({ askParams: mocks.ask }));
vi.mock("../components/overlays/ParamDialog", () => ({ askParams: mocks.ask }));
vi.mock("../lib/revealInspectorCard", () => ({ revealInspectorCard: mocks.reveal }));

const ds = { id: "d1", name: "Alpha", data: { time: [1, 2], values: [[1], [2]], labels: ["m"], units: [""], metadata: {} } };
const find = (id: string): Action => {
  const a = buildDiscoveryCommands(useApp.getState).find((x) => x.id === id);
  if (!a) throw new Error(`no command ${id}`);
  return a;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ask.mockResolvedValue(null);
  mocks.reveal.mockResolvedValue(true);
  useToasts.setState({ toasts: [] });
  useSignalOperationSeed.setState({ op: null, nonce: 0 });
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [ds], activeId: "d1" });
});

describe("deep-linked Signal Processing commands", () => {
  const CASES: [string, string][] = [
    ["signal-normalize-peak", "normalize-peak"],
    ["signal-normalize-range", "normalize-range"],
    ["signal-normalize-zscore", "normalize-zscore"],
    ["signal-normalize-area", "normalize-area"],
    ["signal-normalize-reference", "normalize-reference"],
    ["signal-derivative", "derivative-first"],
    ["signal-derivative-2", "derivative-second"],
    ["signal-derivative-log", "log-derivative"],
    ["signal-integrate", "integral"],
    ["signal-smooth", "smooth"],
    ["signal-detrend", "detrend"],
    ["signal-fft", "fft"],
    ["signal-filter", "filter"],
    ["signal-correlation", "correlation"],
    ["signal-despike", "despike"],
    ["signal-median", "median"],
  ];
  it.each(CASES)("%s opens Signal Processing on %s", (id, op) => {
    find(id).run();
    expect(useApp.getState().signalProcessingOpen).toBe(true);
    expect(useSignalOperationSeed.getState().op).toBe(op);
  });

  it("every operation it seeds is one the panel's picker offers", async () => {
    const picker = await import("../components/workshops/signalprocessing/SignalOperationPicker");
    // Rendered, so the check follows the real option list rather than a copy of it.
    const { render, screen } = await import("@testing-library/react");
    const React = await import("react");
    render(React.createElement(picker.default, { value: "smooth", onChange: () => undefined }));
    const offered = Array.from(screen.getByLabelText("Operation").querySelectorAll("option")).map((o) => o.getAttribute("value"));
    for (const [, op] of CASES) expect(offered, op).toContain(op);
  });
});

describe("Export PDF / SVG / PNG", () => {
  it.each([["export-pdf", "pdf"], ["export-svg", "svg"], ["export-png", "png"]])("%s pre-selects the %s format in the Export figure dialog", async (id, fmt) => {
    find(id).run();
    await vi.waitFor(() => expect(mocks.ask).toHaveBeenCalled(), { timeout: 8000 });
    const [title, fields] = mocks.ask.mock.calls[0];
    expect(title).toBe("Export figure");
    expect(fields.find((f: Field) => f.key === "fmt")).toMatchObject({ default: fmt });
  });

  it("the plain Export figure… command still defaults to PDF", async () => {
    const plain = buildAppActions(useApp.getState).find((a) => a.id === "export-figure");
    plain?.run();
    await vi.waitFor(() => expect(mocks.ask).toHaveBeenCalled(), { timeout: 8000 });
    expect(mocks.ask.mock.calls[0][1].find((f: Field) => f.key === "fmt")).toMatchObject({ default: "pdf" });
  });
});

describe("axis scale commands", () => {
  it("a change that changes nothing adds no history entry and no macro line", () => {
    useApp.getState().setYScale("log");
    const history = useApp.getState().history.length;
    const macro = JSON.stringify(useApp.getState().macroSteps ?? null);
    find("scale-y-log").run();
    find("scale-x-linear").run(); // X is already linear
    expect(useApp.getState().history).toHaveLength(history);
    expect(JSON.stringify(useApp.getState().macroSteps ?? null)).toBe(macro);
    find("scale-y-linear").run(); // a real change still records exactly one step
    expect(useApp.getState().history).toHaveLength(history + 1);
  });

  it("describes the axis by name (an exchanged axis keeps its scale) and says what a secondary Y does", () => {
    const d = (id: string) => find(id).description ?? "";
    expect(d("scale-y-log")).toContain("Y axis");
    expect(d("scale-x-log")).toContain("X axis");
    expect(d("scale-y-log")).not.toMatch(/vertical|horizontal/);
    expect(d("scale-y-log")).toMatch(/secondary Y axis/);
  });

  it("set the scale outright, rather than cycling", () => {
    find("scale-y-log").run();
    expect(useApp.getState().yScale).toBe("log");
    find("scale-y-log").run(); // idempotent: a cycle would have moved on to reciprocal
    expect(useApp.getState().yScale).toBe("log");
    find("scale-y-linear").run();
    expect(useApp.getState().yScale).toBe("linear");
    find("scale-x-log").run();
    expect(useApp.getState().xScale).toBe("log");
    find("scale-x-linear").run();
    expect(useApp.getState().xScale).toBe("linear");
  });
});

describe("Error bars…", () => {
  it("opens the Error columns card, expanding a collapsed sidebar first", async () => {
    useApp.setState({ rightCollapsed: true });
    find("error-bars").run();
    expect(useApp.getState().rightCollapsed).toBe(false);
    await vi.waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith("Error columns"));
  });

  it("says why nothing happened when there is no card to open (no dataset)", async () => {
    mocks.reveal.mockResolvedValue(false);
    useApp.setState({ activeId: null });
    find("error-bars").run();
    await vi.waitFor(() => expect(useToasts.getState().toasts.at(-1)?.msg).toMatch(/Select a dataset/));
  });

  it("does not tell a user WITH a dataset to select one", async () => {
    mocks.reveal.mockResolvedValue(false);
    find("error-bars").run();
    await vi.waitFor(() => expect(useToasts.getState().toasts.at(-1)?.msg).toMatch(/not available for this dataset/));
    expect(useToasts.getState().toasts.at(-1)?.msg).not.toMatch(/Select a dataset/);
  });
});

describe("registry shape", () => {
  const all = buildDiscoveryCommands(useApp.getState);
  it("are palette-only, one-sentence, with a category", () => {
    for (const a of all) {
      expect(a.paletteOnly, a.id).toBe(true);
      expect(a.description?.length, a.id).toBeGreaterThan(20);
      expect(a.group, a.id).toBeTruthy();
    }
  });
  it("are part of the full command list", () => {
    const ids = new Set(buildAppActions(useApp.getState).map((a) => a.id));
    for (const a of all) expect(ids.has(a.id), a.id).toBe(true);
  });
});
