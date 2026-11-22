// Fit Y by X's bivariate leg posts /api/stats/regression by dataset handle
// when the server holds the worksheet: the rows are the finite pairs, so the
// columns read at those rows are exactly the x/y the array request carries
// (tests/test_api_handle_inputs_more.py pins the server half).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberHandle } from "../../../lib/api/datasetCache";
import type { DataStruct } from "../../../lib/types";
import { gatherRows } from "../../../test/gatherRows";
import { runLeg } from "./runLeg";

const NaN_ = Number.NaN;
const data: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7],
  values: [[1, 2], [2, 4.1], [NaN_, 6], [4, 8.2], [5, NaN_], [6, 12], [7, 14.3], [8, 15.9]],
  labels: ["x", "y"], units: ["", ""], metadata: {},
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ N: 6, coeffs: [0, 2] }), {
    status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("runLeg bivariate transport", () => {
  it("names the dataset and the finite rows when the server holds it", async () => {
    const mine: DataStruct = { ...data };
    rememberHandle(mine, "h-biv");
    const out = await runLeg(mine, "bivariate", 0, 1, 1);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/stats/regression");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ dataset_handle: "h-biv", x_channel: 0, y_channel: 1, order: 1 });
    expect(body).not.toHaveProperty("x");
    expect(body.band_x).toHaveLength(40);
    const got = gatherRows(mine, body);
    expect(JSON.stringify(got.x)).toBe(JSON.stringify(out.bivariate!.x));
    expect(JSON.stringify(got.y)).toBe(JSON.stringify(out.bivariate!.y));
  });

  it("posts x/y when no handle is known", async () => {
    await runLeg({ ...data }, "bivariate", 0, 1, 1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.x).toHaveLength(6);
    expect(body).not.toHaveProperty("dataset_handle");
  });
});
