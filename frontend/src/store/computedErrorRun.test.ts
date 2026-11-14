// Gap audit 2 #14: error bars from a computed source (√Y, % of Y, constant).
// Each is a LINKED formula column bound as the series' symmetric Y error, in
// one undo step, reaching the plot (errKeys / hidden column), the fit (errKeys
// is what "y errors" weighting reads) and the recorded, replayable step.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import ErrorRolesCard from "../components/Inspector/ErrorRolesCard";
import { dyForFit } from "../lib/fitweights";
import type { Dataset } from "../lib/types";
import { executeSteps } from "../components/workshops/pipeline/executeSteps";
import { makeStep } from "../lib/pipeline";
import { addComputedError, errorExpr } from "./computedErrorRun";
import { useApp } from "./useApp";

const ds = (): Dataset => ({
  id: "d",
  name: "scan.xy",
  data: { time: [10, 20, 30, 40], values: [[100], [0], [16], [-4]], labels: ["I"], units: ["counts"], metadata: {} },
});
const state = () => useApp.getState().datasets[0];
const col = (d: Dataset, c: number) => d.data.values.map((r) => r[c]);

beforeEach(() => {
  useApp.setState({
    datasets: [ds()],
    activeId: "d",
    status: "",
    history: [],
    future: [],
    errKeys: {},
    hiddenChannels: [],
    macroRecording: true,
    macroSteps: [],
    plotWindows: [],
  });
});

describe("computed error columns", () => {
  it("√Y adds a linked column (Y below 1 counts as 1) bound as the series' error, as ONE undo step", async () => {
    const before = useApp.getState().history.length;
    const r = await addComputedError("d", 0, "sqrt");
    expect(r.ok).toBe(true);
    const d = state();
    expect(d.data.labels).toEqual(["I", "√(I)"]);
    expect(d.data.units[1]).toBe("counts");
    expect(col(d, 1)).toEqual([10, 1, 4, 1]);
    expect(d.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(useApp.getState().history.length).toBe(before + 1);
    // The live view: drawn as error bars, not as a curve of its own.
    expect(useApp.getState().errKeys).toEqual({ 0: 1 });
    expect(useApp.getState().hiddenChannels).toContain(1);
    // Linked: editing Y recomputes the error.
    expect(d.formulas?.[0].expr).toBe("sqrt(max(A, 1))");
  });

  it("feeds a fit's y-error weighting", async () => {
    await addComputedError("d", 0, "percent", 10);
    const d = state();
    expect(col(d, 1)).toEqual([10, 0, 1.6, 0.4]);
    const { dy } = dyForFit(d, 0, { mode: "yerr", errKey: useApp.getState().errKeys[0] }, [0, 2, 3]);
    expect(dy?.[0]).toBeCloseTo(10);
  });

  it("a constant error, and refusals", async () => {
    expect(errorExpr("constant", "B", 2.5)).toBe("2.5 + 0 * B");
    expect((await addComputedError("d", 0, "percent", -1)).ok).toBe(false);
    expect(state().data.labels).toEqual(["I"]);
    await addComputedError("d", 0, "constant", 2.5);
    expect(col(state(), 1)).toEqual([2.5, 2.5, 2.5, 2.5]);
  });

  it("records a step whose replay re-binds the error", async () => {
    await addComputedError("d", 0, "sqrt");
    const step = useApp.getState().macroSteps.at(-1)!;
    expect(step.params).toMatchObject({ name: "√(I)", expr: "sqrt(max(A, 1))", errorOf: "A" });
    useApp.setState({ datasets: [{ ...ds(), id: "e" }], activeId: "e" });
    await executeSteps([makeStep("expression", step.label, step.code, step.params)], "e");
    const e = useApp.getState().datasets[0];
    expect(col(e, 1)).toEqual([10, 1, 4, 1]);
    expect(e.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("is reachable from the Error columns card", async () => {
    render(createElement(ErrorRolesCard, { active: state() }));
    fireEvent.change(screen.getByRole("combobox", { name: "Computed error source" }), { target: { value: "constant" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Constant error" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add computed error" }));
    await waitFor(() => expect(state().errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]));
    expect(col(state(), 1)).toEqual([3, 3, 3, 3]);
  });
});
