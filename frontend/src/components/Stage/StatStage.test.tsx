// View-level coverage for StatStage's facet grid (GUI_INTERACTION #11): the
// hook (useStatStage.test.ts) already covers the compute logic, so this file
// mocks the hook entirely and asserts on what the VIEW does with a given
// StatStageState — the workshop-pattern split lets the two stay independent.

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveStatMarks } from "../../lib/statMarks";
import { useApp } from "../../store/useApp";
import StatStage from "./StatStage";
import type { StatDrawData } from "./statRender";
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
    group2Col: null,
    setGroup2Col: vi.fn(),
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
    marks: resolveStatMarks(overrides.mode ?? "box", {}),
    setMarks: vi.fn(),
    facetCol: null,
    setFacetCol: vi.fn(),
    colorCol: null,
    setColorCol: vi.fn(),
    busy: false,
    error: null,
    note: null,
    groupNotice: null,
    errorNote: null,
    draw: { mode: "box", boxes: [], valueLabel: "y", groupLabel: "grp" },
    drawFacets: null,
    exportFigure: vi.fn().mockResolvedValue(true),
    axes: null,
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

  it('"colour by" offers the plot\'s own factors (bar: the group only) and sets the pick', () => {
    const setColorCol = vi.fn();
    stateRef.current = makeState({ mode: "box", groupCol: 0, group2Col: 2, colorCol: 2, setColorCol });
    const { rerender } = render(<StatStage />);
    const picker = screen.getByRole("combobox", { name: "colour by" }) as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual(["(position)", "grp", "fac"]);
    expect(picker.value).toBe("2");
    fireEvent.change(picker, { target: { value: "0" } });
    expect(setColorCol).toHaveBeenLastCalledWith(0);
    stateRef.current = makeState({ mode: "bar", groupCol: 0, group2Col: 2 });
    rerender(<StatStage />);
    const bar = screen.getByRole("combobox", { name: "colour by" }) as HTMLSelectElement;
    expect(Array.from(bar.options).map((o) => o.textContent)).toEqual(["(position)", "grp"]);
    stateRef.current = makeState({ mode: "box", groupCol: null });
    rerender(<StatStage />);
    expect(screen.queryByRole("combobox", { name: "colour by" })).not.toBeInTheDocument();
  });

  it("the facet-by picker's options are the categorical columns, plus (none)", () => {
    // groupCol: null so neither categorical column is omitted here — the
    // omission-of-groupCol/group2Col behavior gets its own tests below.
    stateRef.current = makeState({ mode: "box", groupCol: null, facetCol: 2 });
    render(<StatStage />);
    const picker = screen.getByRole("combobox", { name: "facet by" }) as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual(["(none)", "grp", "fac"]);
    expect(picker.value).toBe("2");
  });

  it('the "facet by" picker omits the column already chosen as "group by"', () => {
    // Faceting by the same column used to group puts exactly one level in
    // every panel -- one box per panel, which is the pre-existing degenerate
    // case this residual also covers.
    stateRef.current = makeState({ mode: "box", groupCol: 0, facetCol: null });
    const { rerender } = render(<StatStage />);
    const picker = () => screen.getByRole("combobox", { name: "facet by" }) as HTMLSelectElement;
    expect(Array.from(picker().options).map((o) => o.textContent)).toEqual(["(none)", "fac"]);

    // ...and it follows "group by", rather than omitting a fixed column.
    stateRef.current = makeState({ mode: "box", groupCol: 2, facetCol: null });
    rerender(<StatStage />);
    expect(Array.from(picker().options).map((o) => o.textContent)).toEqual(["(none)", "grp"]);
  });

  it('the "facet by" picker omits the column already chosen as "then by"', () => {
    // Faceting by the same column used as the nested second factor makes
    // every box in a panel share the same constant nested half.
    stateRef.current = makeState({ mode: "box", groupCol: 0, group2Col: 2, facetCol: null });
    render(<StatStage />);
    const picker = screen.getByRole("combobox", { name: "facet by" }) as HTMLSelectElement;
    // groupCol (0/"grp") and group2Col (2/"fac") are both omitted, leaving
    // only "(none)".
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual(["(none)"]);
  });

  it("the facet-by picker always shows the LIVE facet column, even when group/then-by make it degenerate", async () => {
    // Review finding 1, in the three states it was measured in. The filter used
    // to drop the very column the picker was displaying, so the `<select>` read
    // "(none)" while the stage drew one panel per facet level — and because
    // "(none)" was then already `selectedIndex` 0, choosing it fired no `change`
    // event, `setFacetCol(null)` was never called, and the facet could not be
    // cleared from its own control. Asserted at the DOM layer, which is the
    // layer the defect lived at: the state was right the whole time.
    const cases: { picks: Partial<StatStageState>; options: string[]; value: string }[] = [
      { picks: { groupCol: 0, facetCol: 0 }, options: ["(none)", "grp", "fac"], value: "0" },
      { picks: { groupCol: 2, facetCol: 2 }, options: ["(none)", "grp", "fac"], value: "2" },
      { picks: { groupCol: 0, group2Col: 2, facetCol: 2 }, options: ["(none)", "fac"], value: "2" },
    ];
    for (const { picks, options, value } of cases) {
      const where = JSON.stringify(picks);
      const setFacetCol = vi.fn();
      stateRef.current = makeState({ mode: "box", setFacetCol, ...picks });
      const { unmount } = render(<StatStage />);
      const picker = screen.getByRole("combobox", { name: "facet by" }) as HTMLSelectElement;
      expect(Array.from(picker.options).map((o) => o.textContent), where).toEqual(options);
      expect(picker.value, where).toBe(value);
      expect(picker.value, where).not.toBe("none");
      expect(picker.selectedIndex, where).toBeGreaterThan(0);
      // The reachability half: clearing needs a real `change`, which the DOM
      // only fires because the selection is moving off the facet column.
      await userEvent.selectOptions(picker, "none");
      expect(setFacetCol, where).toHaveBeenCalledWith(null);
      unmount();
    }
  });

  it('the "then by" picker omits the column already chosen as "group by" (Group R)', () => {
    // Nesting a column inside itself labels every box `grp = 0 / grp = 0`.
    // The hook's mask refuses that value anyway (it cannot trust one picker),
    // but the list must not offer it in the first place.
    stateRef.current = makeState({ mode: "box", groupCol: 0 });
    const { rerender } = render(<StatStage />);
    const picker = () => screen.getByRole("combobox", { name: "then by" }) as HTMLSelectElement;
    expect(Array.from(picker().options).map((o) => o.textContent)).toEqual(["(none)", "fac"]);

    // ...and it follows "group by", rather than omitting a fixed column.
    stateRef.current = makeState({ mode: "box", groupCol: 2 });
    rerender(<StatStage />);
    expect(Array.from(picker().options).map((o) => o.textContent)).toEqual(["(none)", "grp"]);
  });

  it('shows "then by" for box/violin/strip, and NOT for bar/qq/histogram', () => {
    // Bar's category slots come from one column (it builds a category x series
    // matrix), and qq/histogram do not group at all — the hook holds the pick
    // inert in those modes, so offering the control would be a lie.
    for (const mode of ["box", "violin", "strip"] as const) {
      stateRef.current = makeState({ mode, groupCol: 0 });
      const { unmount } = render(<StatStage />);
      expect(screen.getByRole("combobox", { name: "then by" })).toBeInTheDocument();
      unmount();
    }
    for (const mode of ["bar", "qq", "histogram"] as const) {
      stateRef.current = makeState({ mode, groupCol: 0 });
      const { unmount } = render(<StatStage />);
      expect(screen.queryByRole("combobox", { name: "then by" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('hides "then by" under the per-plotted-channel fallback (groupCol null)', () => {
    // With no first factor the groups are CHANNELS, not levels — there is
    // nothing to nest inside, and the hook masks any pick to null.
    stateRef.current = makeState({ mode: "box", groupCol: null });
    render(<StatStage />);
    expect(screen.queryByRole("combobox", { name: "then by" })).not.toBeInTheDocument();
  });

  it('"then by" reflects the current pick and reports changes', async () => {
    const setGroup2Col = vi.fn();
    stateRef.current = makeState({ mode: "box", groupCol: 0, group2Col: 2, setGroup2Col });
    render(<StatStage />);
    const picker = screen.getByRole("combobox", { name: "then by" }) as HTMLSelectElement;
    expect(picker.value).toBe("2");

    await userEvent.selectOptions(picker, "none");
    expect(setGroup2Col).toHaveBeenCalledWith(null);
  });

  it('"then by" can actually SET a nest, not just clear one', async () => {
    // Review finding 7: the test above only exercises the `null` branch, so a
    // handler hard-wired to `st.setGroup2Col(null)` — one that can never turn
    // nesting ON from the UI at all — passed it and every other test here.
    // This pins the forward direction and the `Number(e.target.value)`
    // coercion, which nothing else covered.
    const setGroup2Col = vi.fn();
    stateRef.current = makeState({ mode: "box", groupCol: 0, group2Col: null, setGroup2Col });
    render(<StatStage />);
    const picker = screen.getByRole("combobox", { name: "then by" }) as HTMLSelectElement;
    expect(picker.value).toBe("none");

    await userEvent.selectOptions(picker, "2");
    expect(setGroup2Col).toHaveBeenCalledWith(2);
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

const STRIP_DRAW: StatDrawData = { mode: "strip", boxes: [], points: [], valueLabel: "y", groupLabel: "grp" };
const control = (name: string) => screen.queryByRole("combobox", { name });

describe("StatStage — categorical marks controls (JMP_GAP J5, P2.6 box 1)", () => {
  it("offers Strip as a mode option", () => {
    stateRef.current = makeState({ mode: "box" });
    render(<StatStage />);
    expect(screen.getByRole("tab", { name: "Strip" })).toBeInTheDocument();
  });

  it("box: points, summary and error bars; jitter only once every point is shown", () => {
    stateRef.current = makeState({ mode: "box" });
    const { unmount } = render(<StatStage />);
    expect(control("raw points")).toHaveValue("outliers");
    expect(control("summary marker")).toHaveValue("none");
    // Error bars are about the mean: inert until the mean marker is on.
    expect(control("error bars")).toBeDisabled();
    expect(control("jitter width")).toBeNull(); // box outliers are its fliers, on the centre line
    unmount();
    stateRef.current = makeState({ mode: "box", marks: resolveStatMarks("box", { points: "all", summary: "mean" }) });
    render(<StatStage />);
    expect(control("jitter width")).toHaveValue("0.7");
    expect(control("error bars")).toBeEnabled();
    expect(control("error bars")).toHaveValue("ci95");
  });

  it("strip: every point by default, jittered; violin: points + jitter, summary + error bars", () => {
    stateRef.current = makeState({ mode: "strip", draw: STRIP_DRAW });
    const { unmount } = render(<StatStage />);
    expect(control("raw points")).toHaveValue("all");
    expect(control("jitter width")).toHaveValue("0.85");
    expect(control("summary marker")).toBeInTheDocument();
    unmount();
    stateRef.current = makeState({ mode: "violin", draw: null, marks: resolveStatMarks("violin", { points: "all" }) });
    render(<StatStage />);
    expect(control("raw points")).toHaveValue("all");
    expect(control("jitter width")).toBeInTheDocument();
    // P2.6 box 1, second pass: violin takes the summary marker; its error
    // bars come alive with the mean, as box / strip's do.
    expect(control("summary marker")).toHaveValue("none");
    expect(control("error bars")).toBeDisabled();
  });

  it("bar: error bars (SE by default) + grouped points / summary, off when stacked; qq/histogram: none of it", () => {
    stateRef.current = makeState({ mode: "bar", draw: null, marks: resolveStatMarks("bar", {}) });
    const { unmount } = render(<StatStage />);
    expect(control("error bars")).toHaveValue("se");
    expect(control("error bars")).toBeEnabled();
    expect(control("raw points")).toHaveValue("none");
    expect(control("raw points")).toBeEnabled();
    expect(control("summary marker")).toBeEnabled();
    expect(control("label rotation")).toBeInTheDocument();
    unmount();
    stateRef.current = makeState({ mode: "bar", draw: null, barStack: true, marks: resolveStatMarks("bar", {}) });
    const { unmount: u0 } = render(<StatStage />);
    expect(control("raw points")).toBeDisabled();
    expect(control("summary marker")).toBeDisabled();
    expect(control("error bars")).toBeEnabled();
    u0();
    for (const mode of ["qq", "histogram"] as const) {
      stateRef.current = makeState({ mode, draw: null });
      const { unmount: u } = render(<StatStage />);
      expect(screen.queryByTestId("stat-marks-controls")).toBeNull();
      u();
    }
  });

  it("each control writes one patch through setMarks", async () => {
    const setMarks = vi.fn();
    stateRef.current = makeState({ mode: "box", setMarks, marks: resolveStatMarks("box", { summary: "mean" }) });
    render(<StatStage />);
    await userEvent.selectOptions(control("raw points") as HTMLElement, "none");
    await userEvent.selectOptions(control("summary marker") as HTMLElement, "median");
    await userEvent.selectOptions(control("error bars") as HTMLElement, "sd");
    await userEvent.selectOptions(control("label rotation") as HTMLElement, "45");
    await userEvent.click(screen.getByRole("checkbox", { name: /wrap/ }));
    expect(setMarks.mock.calls.map((c) => c[0])).toEqual([
      { points: "none" }, { summary: "median" }, { errorBars: "sd" }, { labelRotation: 45 }, { labelWrap: true },
    ]);
  });

  it("jitter: off, or a width preset", async () => {
    const setMarks = vi.fn();
    stateRef.current = makeState({ mode: "strip", draw: STRIP_DRAW, setMarks, marks: resolveStatMarks("strip", {}) });
    render(<StatStage />);
    await userEvent.selectOptions(control("jitter width") as HTMLElement, "off");
    await userEvent.selectOptions(control("jitter width") as HTMLElement, "0.5");
    expect(setMarks.mock.calls.map((c) => c[0])).toEqual([{ jitter: false }, { jitter: true, jitterWidth: 0.5 }]);
  });

  it("strip mode offers the facet-by picker (JMP_GAP J5 residual closed: faceted strip)", async () => {
    const setFacetCol = vi.fn();
    stateRef.current = makeState({ mode: "strip", draw: STRIP_DRAW, setFacetCol });
    render(<StatStage />);
    const picker = screen.getByRole("combobox", { name: "facet by" });
    const option = [...(picker as HTMLSelectElement).options].find((o) => o.value !== "none");
    if (!option) throw new Error("expected a facet column option");
    await userEvent.selectOptions(picker, option.value);
    expect(setFacetCol).toHaveBeenCalledWith(Number(option.value));
  });
});

describe("StatStage — connect-means line (JMP_GAP J5 residual)", () => {
  it("box / strip with a group column active show the connect-means checkbox", () => {
    stateRef.current = makeState({ mode: "box", groupCol: 0 });
    const { unmount } = render(<StatStage />);
    expect(screen.getByText("connect means")).toBeInTheDocument();
    unmount();
    stateRef.current = makeState({ mode: "strip", groupCol: 0, draw: STRIP_DRAW });
    render(<StatStage />);
    expect(screen.getByText("connect means")).toBeInTheDocument();
  });

  it("hides the connect-means checkbox under the per-plotted-channel fallback (groupCol null)", () => {
    stateRef.current = makeState({ mode: "box", groupCol: null });
    render(<StatStage />);
    expect(screen.queryByText("connect means")).not.toBeInTheDocument();
  });

  it("hides the connect-means checkbox for violin/qq/histogram/bar", () => {
    for (const mode of ["violin", "qq", "histogram", "bar"] as const) {
      stateRef.current = makeState({ mode, groupCol: 0, draw: null });
      const { unmount } = render(<StatStage />);
      expect(screen.queryByText("connect means")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("toggling the connect-means checkbox patches the marks", () => {
    const setMarks = vi.fn();
    stateRef.current = makeState({ mode: "box", groupCol: 0, setMarks });
    render(<StatStage />);
    screen.getByText("connect means").click();
    expect(setMarks).toHaveBeenCalledWith({ connectMeans: true }, "toggle connect means");
  });
});

describe("StatStage — missing levels / unbalanced groups (P2.6 box 2)", () => {
  beforeEach(() => {
    useApp.setState({ statHideEmptyLevels: false, statShowGroupN: true });
  });

  it("the two options write the persisted PlotView fields", () => {
    stateRef.current = makeState({ mode: "box" });
    render(<StatStage />);
    screen.getByText("empty levels").click();
    expect(useApp.getState().statHideEmptyLevels).toBe(true);
    screen.getByText("n").click();
    expect(useApp.getState().statShowGroupN).toBe(false);
  });

  it("offers both options for every categorical mode, neither for Q-Q / histogram", () => {
    for (const mode of ["box", "violin", "strip", "bar"] as const) {
      stateRef.current = makeState({ mode, draw: null });
      const { unmount } = render(<StatStage />);
      expect(screen.getByText("empty levels")).toBeInTheDocument();
      expect(screen.getByText("n")).toBeInTheDocument();
      unmount();
    }
    for (const mode of ["qq", "histogram"] as const) {
      stateRef.current = makeState({ mode, draw: null });
      const { unmount } = render(<StatStage />);
      expect(screen.queryByText("empty levels")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("shows the one-line notice with the per-level breakdown as its tooltip", () => {
    stateRef.current = makeState({
      groupNotice: {
        line: "1 empty level (n=0) · 2 rows dropped (2 non-finite, 0 excluded/filtered)",
        detail: "grp = C: n=0, 2 non-finite",
        caveat: null,
      },
    });
    render(<StatStage />);
    const notice = screen.getByTestId("stat-group-notice");
    expect(notice).toHaveTextContent("1 empty level (n=0)");
    expect(notice).toHaveAttribute("title", "grp = C: n=0, 2 non-finite");
  });
});
