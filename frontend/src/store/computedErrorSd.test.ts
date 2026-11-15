// Gap audit 3, N9: the computed error source "SD of the data" — the per-row
// sample standard deviation (n-1) across chosen replicate columns, and its
// standard error (SD/√n). Like the other computed sources it is a LINKED
// formula column bound as the series' symmetric Y error, so a fit's y-error
// weighting (errKeys -> dyForFit) reads it with no extra wiring.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import ErrorRolesCard from "../components/Inspector/ErrorRolesCard";
import { dyForFit } from "../lib/fitweights";
import type { Dataset } from "../lib/types";
import { addComputedError, errorExpr } from "./computedErrorRun";
import { useApp } from "./useApp";

// A = the plotted mean; B, C, D = three replicate measurements.
const ds = (): Dataset => ({
  id: "d",
  name: "runs.xy",
  data: {
    time: [1, 2, 3, 4],
    values: [
      [12, 10, 12, 14],
      [5, 5, 5, 5],
      [3, 1, 2, NaN],
      [8, 7, 9, 8],
    ],
    labels: ["mean", "r1", "r2", "r3"],
    units: ["emu", "emu", "emu", "emu"],
    metadata: {},
  },
});
const state = () => useApp.getState().datasets[0];
const col = (d: Dataset, c: number) => d.data.values.map((r) => r[c]);

beforeEach(() => {
  useApp.setState({
    datasets: [ds()], activeId: "d", status: "", history: [], future: [], errKeys: {},
    hiddenChannels: [], macroRecording: true, macroSteps: [], plotWindows: [],
  });
});

describe("computed error: SD of the data (replicates)", () => {
  it("writes the n-1 sample SD formula over the replicate columns", () => {
    const expr = errorExpr("sd", "A", 0, ["B", "C", "D"]);
    expect(expr).toContain("sqrt(");
    expect(expr).toContain("/ 2)"); // n - 1
    expect(expr).not.toContain("A"); // it describes the replicates, not the mean column
  });

  it("adds a linked column of per-row SDs bound as the series' error, in one undo step", async () => {
    const before = useApp.getState().history.length;
    const r = await addComputedError("d", 0, "sd", 0, [1, 2, 3]);
    expect(r.ok).toBe(true);
    const d = state();
    expect(d.data.labels[4]).toBe("SD of 3 (mean)");
    expect(d.data.units[4]).toBe("emu");
    const sd = col(d, 4);
    expect(sd[0]).toBeCloseTo(2, 12); // 10, 12, 14
    expect(sd[1]).toBeCloseTo(0, 12); // 5, 5, 5
    expect(sd[2]).toBeNaN(); // a missing replicate: blank, never a made-up SD
    expect(sd[3]).toBeCloseTo(1, 12); // 7, 9, 8
    expect(d.errorRoles).toEqual([{ channel: 4, target: 0, axis: "y", side: "both" }]);
    expect(useApp.getState().errKeys).toEqual({ 0: 4 });
    expect(useApp.getState().history.length).toBe(before + 1);
  });

  it("SEM divides by √n", async () => {
    await addComputedError("d", 0, "sem", 0, [1, 2, 3]);
    const d = state();
    expect(d.data.labels[4]).toBe("SEM of 3 (mean)");
    expect(col(d, 4)[0]).toBeCloseTo(2 / Math.sqrt(3), 12);
  });

  it("weights a fit: the SD column is the y-error dyForFit reads", async () => {
    await addComputedError("d", 0, "sd", 0, [1, 2, 3]);
    const { dy } = dyForFit(state(), 0, { mode: "yerr", errKey: useApp.getState().errKeys[0] }, [0, 3]);
    expect(dy?.[0]).toBeCloseTo(2, 12);
    expect(dy?.[3]).toBeCloseTo(1, 12); // dy stays aligned to ALL rows
  });

  it("refuses fewer than two replicates, a bad channel, and a duplicate", async () => {
    expect((await addComputedError("d", 0, "sd", 0, [1])).ok).toBe(false);
    expect((await addComputedError("d", 0, "sd", 0, [1, 9])).ok).toBe(false);
    expect((await addComputedError("d", 0, "sd", 0, [2, 2])).ok).toBe(false);
    expect(state().data.labels).toHaveLength(4);
  });

  it("records a replayable step (the formula carries the replicate letters)", async () => {
    await addComputedError("d", 0, "sd", 0, [1, 2, 3]);
    const step = useApp.getState().macroSteps.at(-1)!;
    expect(step.params).toMatchObject({ errorOf: "A" });
    expect(String((step.params as { expr: string }).expr)).toContain("B");
  });

  it("is reachable from the Error columns card (pick the replicate columns)", async () => {
    render(createElement(ErrorRolesCard, { active: state() }));
    fireEvent.change(screen.getByRole("combobox", { name: "Computed error source" }), { target: { value: "sd" } });
    for (const name of ["r1", "r2", "r3"]) fireEvent.click(screen.getByRole("checkbox", { name: `Replicate ${name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Add computed error" }));
    await waitFor(() => expect(state().errorRoles).toEqual([{ channel: 4, target: 0, axis: "y", side: "both" }]));
    expect(col(state(), 4)[0]).toBeCloseTo(2, 12);
  });
});

describe("computed error: percent of value (re-verified)", () => {
  it("is |Y| x p / 100, bound as the error", async () => {
    await addComputedError("d", 0, "percent", 10);
    expect(col(state(), 4)[0]).toBeCloseTo(1.2, 12);
    expect(state().errorRoles).toEqual([{ channel: 4, target: 0, axis: "y", side: "both" }]);
  });
});

describe("replicate selection follows the target and the dataset (review)", () => {
  it("making a ticked replicate the target unticks it, and it is not silently dropped later", async () => {
    const { rerender } = render(createElement(ErrorRolesCard, { active: state() }));
    fireEvent.change(screen.getByRole("combobox", { name: "Computed error source" }), { target: { value: "sd" } });
    for (const n of ["r1", "r2", "r3"]) fireEvent.click(screen.getByRole("checkbox", { name: `Replicate ${n}` }));
    fireEvent.change(screen.getByRole("combobox", { name: "Computed error series" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Computed error series" }), { target: { value: "0" } });
    expect((screen.getByRole("checkbox", { name: "Replicate r1" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Replicate r2" }) as HTMLInputElement).checked).toBe(true);
    // another dataset: column indices mean other columns, so the ticks reset
    rerender(createElement(ErrorRolesCard, { active: { ...state(), id: "other" } }));
    expect((screen.getByRole("checkbox", { name: "Replicate r2" }) as HTMLInputElement).checked).toBe(false);
  });
});
