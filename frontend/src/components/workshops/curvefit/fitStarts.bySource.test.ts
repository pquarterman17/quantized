// P8: the data-derived starts of an EDITED parameter table are guessed by
// dataset handle when the server holds the dataset (the same rows as the fit),
// and from the posted arrays otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { autoGuess } from "../../../lib/api/curvefit";
import { rememberHandle } from "../../../lib/api/datasetCache";
import type { DataStruct, FitModel } from "../../../lib/types";
import { parseFitStarts } from "./fitStarts";

vi.mock("../../../lib/api/curvefit", () => ({ autoGuess: vi.fn() }));

const data: DataStruct = { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["y"], units: [""], metadata: {} };
const rows = [
  { name: "m", start: "", min: "", max: "", fixed: false },
  { name: "b", start: "5", min: "", max: "", fixed: false },
];
const model = { name: "Linear", category: "poly", paramNames: ["m", "b"], nParams: 2, p0: [1, 1], lb: [-1e9, -1e9], ub: [1e9, 1e9] } as unknown as FitModel;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(autoGuess).mockResolvedValue({ p0: [9, 9] });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ p0: [7, 7] }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("parseFitStarts guess source", () => {
  it("guesses by handle when a source with a handle is given", async () => {
    rememberHandle(data, "h-starts");
    const parsed = await parseFitStarts(rows, model, "Linear", [0, 1, 2], [1, 2, 3], { data, xKey: null, yKey: 0 }, [0, 1, 2]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/fitting/autoguess");
    expect(body).toMatchObject({ model: "Linear", dataset_handle: "h-starts", x_channel: -1, y_channel: 0, rows: [[0, 3]] });
    expect(body).not.toHaveProperty("x");
    expect(autoGuess).not.toHaveBeenCalled();
    expect(parsed.p0).toEqual([7, 5]); // the blank start from the guess, the typed one as typed
  });

  it("posts the arrays without a source (the batch)", async () => {
    await parseFitStarts(rows, model, "Linear", [0, 1, 2], [1, 2, 3]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(autoGuess).toHaveBeenCalledWith("Linear", [0, 1, 2], [1, 2, 3]);
  });
});
