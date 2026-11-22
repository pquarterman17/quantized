// /api/transform/sigop by dataset handle (backend routes/transform.py): a
// worksheet the server holds is named, not posted; a miss resends it once
// (the old request); with no handle the request is the one it always was.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../types";
import { rememberHandle } from "./datasetCache";
import { sigopOf } from "./sigopByHandle";

const held: DataStruct = {
  time: [0, 1, 2], values: [[1], [2], [3]], labels: ["a"], units: [""], metadata: {}, books: [],
} as DataStruct;
const plain = { time: held.time, values: held.values, labels: held.labels, units: held.units, metadata: {} };
const rest = { method: "median", channels: [0], args: { window: 3 } };
const ok = { dataset: held, warnings: [], flagged: {}, rows_in: 3, rows_out: 3 };

let fetchMock: ReturnType<typeof vi.fn>;
const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const bodyOf = (i: number): Record<string, unknown> => JSON.parse(String(fetchMock.mock.calls[i]![1].body));

beforeEach(() => {
  fetchMock = vi.fn(async () => reply(ok));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("sigopOf", () => {
  it("posts the plain dataset, exactly as before, without a handle", async () => {
    await sigopOf({ ...held }, plain, rest);
    expect(Object.keys(bodyOf(0))).toEqual(["dataset", "method", "channels", "args"]);
    expect(bodyOf(0).dataset).toEqual(JSON.parse(JSON.stringify(plain)));
  });

  it("names the dataset when the server holds it", async () => {
    rememberHandle(held, "h-sig");
    await sigopOf(held, plain, rest);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/transform/sigop");
    expect(bodyOf(0)).toEqual({ dataset_handle: "h-sig", ...rest });
  });

  it("resends the dataset once on a miss", async () => {
    const mine = { ...held };
    rememberHandle(mine, "h-gone");
    fetchMock.mockResolvedValueOnce(reply({ detail: "unknown_dataset_handle" }, 409));
    const res = await sigopOf(mine, plain, rest);
    expect(res.rows_out).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(0)).toMatchObject({ dataset_handle: "h-gone" });
    expect(bodyOf(1)).toMatchObject({ dataset: { time: [0, 1, 2] }, method: "median" });
    expect(bodyOf(1)).not.toHaveProperty("dataset_handle");
  });
});
