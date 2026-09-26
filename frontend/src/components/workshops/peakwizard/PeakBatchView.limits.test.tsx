// Peak Analyzer batch — the route's total-points cap is enforced on the
// CLIENT before submit (slice-4 review item 2): datasets past it become
// "not run" rows that say why, the rest are queued, and the request never
// exceeds the cap (so it can never be an all-or-nothing 422). The cap is
// shrunk to 50 points here (each fixture dataset has 30) through the module
// the hook imports it from.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DEFAULT_RECIPE } from "../../../lib/peakwizard";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import PeakBatchView from "./PeakBatchView";

const { findMock } = vi.hoisted(() => ({ findMock: vi.fn() }));
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
}));
vi.mock("./peakBatchPrep", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./peakBatchPrep")>()),
  BATCH_MAX_TOTAL_POINTS: 50,
}));

const N = 30;
const ds = (id: string): Dataset => ({
  id, name: `scan ${id}`,
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => [20 + i * 0.2, 1 + Math.exp(-((i - 15) ** 2) / 4)]),
    labels: ["2theta", "I"], units: ["", ""], metadata: {},
  },
});

let posted: { items: { id: string; x: unknown[] }[] }[] = [];
const json = (v: unknown) =>
  Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  posted = [];
  findMock.mockResolvedValue({
    peaks: [{ center: 23, height: 1, bg: 0, fwhm: 0.6, prominence: 1, localSNR: 20, area: null }],
    background: [],
  });
  const { curves: _c, correlation: _r, ...fit } = modelFitResponse();
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/api/peaks/model-fit-batch") {
      posted.push(JSON.parse(init!.body as string) as (typeof posted)[number]);
      return json({ job_id: "j9", n_items: 1 });
    }
    if (url === "/api/jobs/j9") return json({ status: "done", progress: 1, message: "fitted 1/1" });
    if (url === "/api/jobs/j9/result") {
      return json({ result: { rows: [{ id: "i0", status: "ok", error: null, fit }], n_items: 1, n_ok: 1, n_failed: 0, n_not_run: 0, stopped: null } });
    }
    return json({});
  });
  useApp.setState({ datasets: [ds("a"), ds("b")], activeId: "a", xKey: 0, yKeys: [1], seriesOrder: null, selectedIds: ["a", "b"] });
});
afterEach(() => vi.unstubAllGlobals());

it("queues only what fits the total-points cap; the rest are 'not run' rows saying why", async () => {
  render(<PeakBatchView recipes={[{ ...DEFAULT_RECIPE, name: "r" }]} current="r" pollMs={5} />);
  fireEvent.click(screen.getByRole("button", { name: "Library selection (2)" }));
  fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
  await waitFor(() => expect(screen.getByRole("status", { name: "batch status" })).toHaveTextContent("done"));
  expect(posted).toHaveLength(1);
  expect(posted[0].items.map((i) => i.id)).toEqual(["i0"]);
  expect(posted[0].items.reduce((n, i) => n + i.x.length, 0)).toBeLessThanOrEqual(50);
  const rows = within(screen.getByRole("table", { name: "batch results" })).getAllByRole("row").slice(1);
  const last = rows[rows.length - 1];
  expect(last.getAttribute("data-status")).toBe("not run");
  expect(last).toHaveTextContent("the batch's 50-point limit was reached — pick fewer datasets");
});
