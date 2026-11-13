// A lazy chunk that fails to download must not pass silently (review item
// 11): the recalc pass and the formula module both say so, with a Retry, and
// leave nothing latched or swallowed.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("./toasts", async (orig) => ({ ...(await orig<typeof import("./toasts")>()), toast: toastMock }));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  applyCorrections: vi.fn(async ({ dataset }: { dataset: Dataset["data"] }) => ({ ...dataset, values: [[99]] })),
}));

const data = (): Dataset["data"] => ({ time: [1], values: [[1]], labels: ["v"], units: [""], metadata: {} });
const retry = () => toastMock.mock.calls.at(-1)![2].action;

beforeEach(() => {
  vi.resetModules();
  toastMock.mockReset();
});

describe("the recalc pass module fails to load", () => {
  it("resolves (no unhandled rejection), says so with a Retry, keeps the stale set and drops the everything-latch", async () => {
    vi.doMock("./recalcDatasets", () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    const { useApp } = await import("./useApp");
    const sheet: Dataset = { id: "b", name: "b", data: data(), derivedFrom: { datasetId: "a", pipeline: "p" }, corrections: { yOff: -1 } };
    useApp.setState({ datasets: [{ id: "a", name: "a", data: data() }, sheet], recalcMode: "off", staleDatasets: [], staleFits: [] });

    await expect(useApp.getState().recalcNow({ everything: true })).resolves.toBeUndefined();
    expect(useApp.getState().status).toBe("Recalculation didn't start: its module failed to load — stale results are unchanged");
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining("module failed to load"), "danger", { action: expect.objectContaining({ label: "Retry" }) });

    // The chunk is reachable again. A plain pass must NOT inherit the earlier
    // recalculate-everything: in mode None nothing is stale, so nothing runs.
    vi.doUnmock("./recalcDatasets");
    await useApp.getState().recalcNow();
    expect(useApp.getState().datasets[1].data.values).toEqual([[1]]);
    // Retry re-states the original request, and it now runs.
    retry().onClick();
    await vi.waitFor(() => expect(useApp.getState().datasets[1].data.values).toEqual([[99]]));
    expect(useApp.getState().staleDatasets).toEqual([]);
  });
});

describe("the formula module fails to load", () => {
  it("is announced once with a Retry, retried quietly by the next evaluation, and the waiting formulas then recompute", async () => {
    vi.doMock("../lib/formulaRefs", () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    const { useApp } = await import("./useApp");
    const ext = await import("../lib/formulaExt");
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/formula module didn't load/));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatch(/formula module didn't load/);
    expect(retry().label).toBe("Retry");
    expect(useApp.getState().status).toMatch(/formula module didn't load/);

    useApp.setState({ datasets: [{ id: "a", name: "a", data: data() }] });
    expect(useApp.getState().addFormula("a", "c", "cumsum(A)")).toBe(true);
    expect(useApp.getState().datasets[0].formulaErrors?.c).toBeTruthy(); // an error, never a value

    // Still unreachable: the automatic retry is rate-limited and stays quiet.
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(Date.now() + ext.RETRY_MS + 1);
    ext.formulaExtension();
    await new Promise((r) => setTimeout(r, 20)); // let the quiet retry fail
    expect(toastMock).toHaveBeenCalledTimes(1);

    // Reachable again: the next evaluation's retry loads it and recomputes.
    vi.doUnmock("../lib/formulaRefs");
    now.mockReturnValue(Date.now() + 10 * ext.RETRY_MS);
    ext.formulaExtension();
    await vi.waitFor(() => expect(useApp.getState().datasets[0].formulaErrors).toBeUndefined());
    expect(useApp.getState().datasets[0].data.values).toEqual([[1, 1]]);
    now.mockRestore();
  });
});
