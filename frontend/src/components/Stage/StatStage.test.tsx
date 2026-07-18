// View-level coverage for StatStage's facet grid (GUI_INTERACTION #11): the
// hook (useStatStage.test.ts) already covers the compute logic, so this file
// mocks the hook entirely and asserts on what the VIEW does with a given
// StatStageState — the workshop-pattern split lets the two stay independent.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../store/useApp";
import StatStage from "./StatStage";
import type { StatStageState } from "./useStatStage";

const { stateRef } = vi.hoisted(() => ({ stateRef: { current: null as StatStageState | null } }));

vi.mock("./useStatStage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useStatStage")>()),
  useStatStage: () => stateRef.current,
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

function makeState(overrides: Partial<StatStageState> = {}): StatStageState {
  return {
    hasData: true,
    mode: "box",
    setMode: vi.fn(),
    columns: [
      { index: 0, label: "grp" },
      { index: 1, label: "y" },
      { index: 2, label: "fac" },
    ],
    categoricalCols: [
      { index: 0, label: "grp" },
      { index: 2, label: "fac" },
    ],
    groupCol: 0,
    setGroupCol: vi.fn(),
    valueCol: 1,
    setValueCol: vi.fn(),
    dist: "norm",
    setDist: vi.fn(),
    bins: "fd",
    setBins: vi.fn(),
    fit: null,
    setFit: vi.fn(),
    barStack: false,
    setBarStack: vi.fn(),
    facetCol: null,
    setFacetCol: vi.fn(),
    busy: false,
    error: null,
    note: null,
    draw: { mode: "box", boxes: [], valueLabel: "y", groupLabel: "grp" },
    drawFacets: null,
    exportFigure: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  useApp.setState({ theme: "dark", accent: "violet" });
});

describe("StatStage — facet grid (GUI_INTERACTION #11)", () => {
  it("renders a single canvas when drawFacets is null (the ordinary flat view)", () => {
    stateRef.current = makeState({ drawFacets: null });
    const { container } = render(<StatStage />);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("renders one canvas + caption per facet level when drawFacets is set", () => {
    stateRef.current = makeState({
      draw: null,
      drawFacets: [
        { label: "north", draw: { mode: "box", boxes: [], valueLabel: "y", groupLabel: "grp" } },
        { label: "south", draw: { mode: "box", boxes: [], valueLabel: "y", groupLabel: "grp" } },
        { label: "east", draw: { mode: "box", boxes: [], valueLabel: "y", groupLabel: "grp" } },
      ],
    });
    const { container } = render(<StatStage />);
    expect(container.querySelectorAll("canvas")).toHaveLength(3);
    expect(screen.getByText("north")).toBeInTheDocument();
    expect(screen.getByText("south")).toBeInTheDocument();
    expect(screen.getByText("east")).toBeInTheDocument();
  });

  it('shows the "facet by" picker for box/violin/bar but not for qq/histogram', () => {
    stateRef.current = makeState({ mode: "box" });
    const { rerender } = render(<StatStage />);
    expect(screen.getByRole("combobox", { name: "facet by" })).toBeInTheDocument();

    stateRef.current = makeState({ mode: "violin" });
    rerender(<StatStage />);
    expect(screen.getByRole("combobox", { name: "facet by" })).toBeInTheDocument();

    stateRef.current = makeState({ mode: "bar" });
    rerender(<StatStage />);
    expect(screen.getByRole("combobox", { name: "facet by" })).toBeInTheDocument();

    stateRef.current = makeState({ mode: "qq" });
    rerender(<StatStage />);
    expect(screen.queryByRole("combobox", { name: "facet by" })).not.toBeInTheDocument();

    stateRef.current = makeState({ mode: "histogram" });
    rerender(<StatStage />);
    expect(screen.queryByRole("combobox", { name: "facet by" })).not.toBeInTheDocument();
  });

  it("the facet-by picker's options are the categorical columns, plus (none)", () => {
    stateRef.current = makeState({ mode: "box", facetCol: 2 });
    render(<StatStage />);
    const picker = screen.getByRole("combobox", { name: "facet by" }) as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual(["(none)", "grp", "fac"]);
    expect(picker.value).toBe("2");
  });

  it("Export is enabled for a flat draw AND for a faceted grid (GUI_INTERACTION #12 slice 4b), disabled only when both are empty", () => {
    // Faceted: drawFacets set, flat draw null.
    stateRef.current = makeState({
      draw: null,
      drawFacets: [{ label: "a", draw: { mode: "box", boxes: [], valueLabel: "y", groupLabel: "grp" } }],
    });
    const { rerender } = render(<StatStage />);
    expect(screen.getByRole("button", { name: /Export/ })).not.toBeDisabled();

    // Flat: draw set, drawFacets null.
    stateRef.current = makeState({
      draw: { mode: "box", boxes: [], valueLabel: "y", groupLabel: "grp" },
      drawFacets: null,
    });
    rerender(<StatStage />);
    expect(screen.getByRole("button", { name: /Export/ })).not.toBeDisabled();

    // Neither: nothing to export yet (e.g. an error state).
    stateRef.current = makeState({ draw: null, drawFacets: null });
    rerender(<StatStage />);
    expect(screen.getByRole("button", { name: /Export/ })).toBeDisabled();
  });

  it("shows a hook-provided note when set", () => {
    stateRef.current = makeState({
      draw: { mode: "box", boxes: [], valueLabel: "y", groupLabel: "grp" },
      note: "backend unavailable — computed locally",
    });
    render(<StatStage />);
    expect(screen.getByText(/backend unavailable/)).toBeInTheDocument();
  });
});
