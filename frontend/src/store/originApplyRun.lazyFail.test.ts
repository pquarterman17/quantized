// Load-failure contract for the Origin-apply BODY seam (bundle headroom
// slice 18): `store/originApplyRun.ts` arrives in the same load as the
// apply-only figure libraries, so a body chunk that will not load must fail
// that load's existing preflight — status + danger toast, nothing applied, no
// undo or macro entry — and a later apply must retry the fetch.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, OriginFigure } from "../lib/types";
import { resetOriginApplyLibsForTests } from "./originApplyLibs";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

// Hoisted with the mock, so the factory can read it whenever it runs.
const load = vi.hoisted(() => ({ failNext: false }));
vi.mock("./originApplyRun", async (importOriginal) => {
  if (load.failNext) throw new Error("chunk 404");
  return importOriginal();
});

const book: Dataset = {
  id: "d1",
  name: "Project:Book1",
  data: {
    time: [1, 2],
    values: [[10], [20]],
    labels: ["signal"],
    units: [""],
    metadata: { origin_book: "Book1", x_column_name: "A", origin_column_names: ["B"] },
  },
};

const figure: OriginFigure = {
  name: "GraphA",
  x_from: 0, x_to: 2, x_log: false,
  y_from: 0, y_to: 20, y_log: false,
  n_curves: 1, annotations: [],
  curves: [{ book: "Book1", x: "A", y: "B", style: "line" }],
};

beforeEach(() => {
  load.failNext = false;
  resetOriginApplyLibsForTests(); // every test starts COLD
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [book],
    activeId: null,
    originFigures: [{ id: "a", stem: "Project", figure, datasetId: "d1", siblingIds: ["d1"] }],
    xLim: null,
    history: [],
    macroRecording: true,
    macroSteps: [],
    status: "",
  });
});

describe("applyOriginFigure — the apply body fails to load", () => {
  it("reports the failure and applies nothing", async () => {
    load.failNext = true;
    useApp.getState().applyOriginFigure("a");

    // (vitest wraps a throwing mock factory's error in its own message, so
    // only the app's prefix is asserted.)
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/^couldn't apply Origin figure — /));
    const s = useApp.getState();
    expect(s.xLim).toBeNull();
    expect(s.activeId).toBeNull();
    expect(s.history).toHaveLength(0);
    expect(s.macroSteps).toHaveLength(0);
    const toasts = useToasts.getState().toasts;
    expect(toasts.map((t) => t.kind)).toEqual(["danger"]);
    expect(toasts[0].msg).toBe(s.status);
  });

  it("retries the fetch on the next apply, which then lands", async () => {
    load.failNext = true;
    useApp.getState().applyOriginFigure("a");
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/^couldn't apply Origin figure — /));

    load.failNext = false;
    useApp.getState().applyOriginFigure("a");
    await vi.waitFor(() => expect(useApp.getState().xLim).toEqual([0, 2]));
    expect(useApp.getState().activeId).toBe("d1");
    expect(useApp.getState().macroSteps).toHaveLength(1);
  });
});
