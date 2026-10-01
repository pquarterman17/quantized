// P2.3 box 3 — the SIMS workshop's Compare tab: several profiles' species in
// one comparison table, previewed before anything is created; Create records
// one replayable `simscompare` step and staggers the new plot's traces by
// whole decades (its own undo entry); the current plot's offsets step by one
// decade per click and clear in one undo entry.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimsCompareRequest, SimsCompareResult } from "../../../lib/api/sims";
import { transformParamsOf } from "../../../lib/transformRun";
import type { DataStruct } from "../../../lib/types";
import { useSimsDialog } from "../../../store/simsDialog";
import { useApp } from "../../../store/useApp";
import SimsPanel from "./SimsPanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/sims", () => ({ processSims: vi.fn(), compareSims: vi.fn(), measureSimsRegion: vi.fn() }));
const { compareSims } = await import("../../../lib/api/sims");

/** Stand-in for calc.sims_compare: row blocks, by-name species, null blanks. */
function fakeCompare(body: SimsCompareRequest): Promise<SimsCompareResult> {
  const multi = body.profiles.length > 1;
  const cols: { label: string; block: number; v: (number | null)[] }[] = [];
  body.profiles.forEach((p, b) => {
    for (const s of body.species) {
      const c = p.dataset.labels.indexOf(s);
      if (c >= 0) cols.push({ label: multi ? `${s} — ${p.name.replace(/\.[^.]+$/, "")}` : s, block: b, v: p.dataset.values.map((r) => r[c]) });
    }
  });
  const time = body.profiles.flatMap((p) => p.dataset.time);
  const starts = body.profiles.map((_, b) => body.profiles.slice(0, b).reduce((n, p) => n + p.dataset.time.length, 0));
  const values = time.map((_, row) =>
    cols.map((c) => {
      const i = row - starts[c.block];
      return i >= 0 && i < c.v.length ? c.v[i] : null;
    }),
  ) as number[][];
  return Promise.resolve({
    dataset: { time, values, labels: cols.map((c) => c.label), units: cols.map(() => "atoms/cm3"), metadata: { technique: "sims", x_column_unit: "nm" } },
    warnings: [],
    traces: cols.map((c) => ({ label: c.label })),
  });
}

const a: DataStruct = {
  time: [0, 10, 20],
  values: [[1e18, 5e22], [3e18, 5e22], [2e18, 5e22]],
  labels: ["B", "Si"],
  units: ["atoms/cm3", "atoms/cm3"],
  metadata: { x_column_name: "Depth", x_column_unit: "nm", technique: "sims" },
};
// Another sample, columns in the other order.
const b: DataStruct = { ...a, time: [0, 5], values: [[5e22, 4e17], [5e22, 9e17]], labels: ["Si", "B"] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(compareSims).mockImplementation(fakeCompare);
  useApp.setState({
    datasets: [
      { id: "s1", name: "a.csv", data: a },
      { id: "s2", name: "b.csv", data: b },
    ],
    folders: [],
    activeId: "s1",
    selectedIds: ["s1", "s2"],
    macroRecording: true,
    macroSteps: [],
    history: [],
    future: [],
    seriesStyles: {},
    yKeys: null,
    xKey: null,
    seriesOrder: null,
    waterfall: 0,
    groupKey: null,
    yScale: "log",
  });
  useSimsDialog.setState({ seed: "s1", opened: 1 });
});

const store = useApp.getState;
const openCompare = () => {
  render(<SimsPanel />);
  fireEvent.click(screen.getByRole("radio", { name: "Compare" }));
};

describe("SIMS Compare tab", () => {
  it("previews the selected profiles' common species, then creates one recorded comparison with a decade stagger", async () => {
    openCompare();
    const profiles = screen.getByRole("group", { name: "Profiles" });
    expect(within(profiles).getByRole("checkbox", { name: "a.csv" })).toBeChecked();
    expect(within(profiles).getByRole("checkbox", { name: "b.csv" })).toBeChecked();
    // Same species across samples: only B is wanted here.
    fireEvent.click(within(screen.getByRole("group", { name: "Species" })).getByRole("checkbox", { name: "Si" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Stagger (decades per trace)" }), { target: { value: "2" } });
    const preview = await screen.findByRole("group", { name: "Comparison preview" });
    await waitFor(() => expect(within(preview).getByTestId("sims-preview-plot").querySelectorAll("polyline")).toHaveLength(2));
    expect(preview.textContent).toContain("B — b ×10^2");
    expect(vi.mocked(compareSims).mock.calls.at(-1)?.[0].species).toEqual(["B"]);
    expect(store().datasets).toHaveLength(2); // previewing created nothing

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create comparison" })));
    await waitFor(() => expect(store().datasets).toHaveLength(3));
    const out = store().datasets[2];
    expect(out.name).toBe("a + 1 (SIMS comparison)");
    expect(out.data.labels).toEqual(["B — a", "B — b"]);
    // Blanks outside each trace's block are NaN in memory (so the .dwk reopens).
    expect(out.data.values.map((r) => r[0])).toEqual([1e18, 3e18, 2e18, Number.NaN, Number.NaN]);
    expect(out.data.metadata.sims_compare_sources).toEqual([{ id: "s1", name: "a.csv" }, { id: "s2", name: "b.csv" }]);
    const step = store().macroSteps[0];
    expect(transformParamsOf(step.params as Record<string, unknown>)).toEqual({
      op: "simscompare", species: ["B"], with: [{ id: "s2", name: "b.csv" }],
    });
    // The stagger is the new plot's series styles, on a log axis.
    expect(store().activeId).toBe(out.id);
    expect(store().seriesStyles).toEqual({ 0: { logOffset: 0 }, 1: { logOffset: 2 } });
    expect(store().yScale).toBe("log");
    // Undo #1 removes the stagger only; undo #2 the comparison.
    act(() => store().undo());
    expect(store().seriesStyles).toEqual({});
    expect(store().datasets).toHaveLength(3);
    act(() => store().undo());
    expect(store().datasets.map((d) => d.id)).toEqual(["s1", "s2"]);
  });

  it("keeps a tab's half-filled form across a tab switch", () => {
    openCompare();
    fireEvent.change(screen.getByRole("textbox", { name: "Stagger (decades per trace)" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("radio", { name: "Process" }));
    expect(screen.getByRole("textbox", { name: "Stagger (decades per trace)", hidden: true })).not.toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "Compare" }));
    expect((screen.getByRole("textbox", { name: "Stagger (decades per trace)" }) as HTMLInputElement).value).toBe("3");
  });

  it("refuses a non-integer stagger and needs a species", async () => {
    openCompare();
    fireEvent.change(screen.getByRole("textbox", { name: "Stagger (decades per trace)" }), { target: { value: "1.5" } });
    expect(screen.getByText(/whole number of decades/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create comparison" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Stagger (decades per trace)" }), { target: { value: "0" } });
    const species = within(screen.getByRole("group", { name: "Species" }));
    fireEvent.click(species.getByRole("checkbox", { name: "B" }));
    fireEvent.click(species.getByRole("checkbox", { name: "Si" }));
    expect(screen.getByText("Pick at least one species.")).toBeTruthy();
  });

  it("refuses a stagger whose span would exceed the ±30-decade limit before it reaches the preview (finding 2: 8 traces × 6 decades)", async () => {
    // 8 profiles, one shared species -- 8 resulting traces. At stagger 6 the
    // last trace would sit 7*6=42 decades up, past what `logOffsetDecades`/
    // `log_offset_decades` actually honour (MAX_DECADES=30): the COMMITTED
    // plot would silently zero it while an unclamped preview kept drawing it
    // offset. The form must refuse this stagger outright instead.
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      name: `p${i}.csv`,
      data: {
        time: [0, 10],
        values: [[1e18], [2e18]],
        labels: ["B"],
        units: ["atoms/cm3"],
        metadata: { x_column_name: "Depth", x_column_unit: "nm", technique: "sims" },
      },
    }));
    useApp.setState({ datasets: many, selectedIds: many.map((d) => d.id), activeId: many[0].id });
    useSimsDialog.setState({ seed: many[0].id, opened: 2 });
    openCompare();
    expect(within(screen.getByRole("group", { name: "Profiles" })).getAllByRole("checkbox", { checked: true })).toHaveLength(8);
    fireEvent.change(screen.getByRole("textbox", { name: "Stagger (decades per trace)" }), { target: { value: "6" } });
    expect(screen.getByText(/8 traces × 6 decades would span 42 decades/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create comparison" })).toBeDisabled();
    // The gate means no offset preview is ever drawn for this stagger.
    expect(screen.queryByRole("group", { name: "Comparison preview" })).toBeNull();
    // A stagger small enough to fit is accepted again.
    fireEvent.change(screen.getByRole("textbox", { name: "Stagger (decades per trace)" }), { target: { value: "4" } });
    await waitFor(() => expect(screen.getByRole("group", { name: "Comparison preview" })).toBeTruthy());
  });

  it("steps the current plot's offsets one decade per click, and clears them in one undo entry", () => {
    openCompare();
    const offsets = within(screen.getByRole("group", { name: "Decade offsets" }));
    fireEvent.click(offsets.getByRole("button", { name: "Si one decade up" }));
    fireEvent.click(offsets.getByRole("button", { name: "Si one decade up" }));
    fireEvent.click(offsets.getByRole("button", { name: "B one decade down" }));
    expect(store().seriesStyles).toEqual({ 0: { logOffset: -1 }, 1: { logOffset: 2 } });
    expect(offsets.getByLabelText("Si offset").textContent).toBe("×10^2");
    expect(store().history).toHaveLength(3);
    fireEvent.click(offsets.getByRole("button", { name: "Clear offsets" }));
    expect(store().seriesStyles).toEqual({ 0: {}, 1: {} });
    expect(store().history).toHaveLength(4);
    act(() => store().undo());
    expect(store().seriesStyles).toEqual({ 0: { logOffset: -1 }, 1: { logOffset: 2 } });
  });
});
