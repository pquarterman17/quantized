// Text to columns commits through the shared result contract: a NEW worksheet,
// the source untouched, one undo step with the Library result, no duplicate on
// a repeat, out of date when the source changes, refusals say why.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
import { runTextToColumns } from "./textToColumnsRun";
import { useApp } from "./useApp";

vi.mock("./toasts", () => ({ toast: vi.fn() }));

const sheet = (): Dataset => ({
  id: "w",
  name: "scan",
  workbookId: "B",
  data: {
    time: [1, 2, 3],
    values: [[5], [6], [7]],
    labels: ["M"],
    units: ["emu"],
    metadata: { origin_text_columns: { Cond: ["300 K;0.1", "310 K;0.2", "320 K;0.3"] } },
  },
});

const st = () => useApp.getState();

beforeEach(() => {
  useApp.setState({ datasets: [sheet()], activeId: "w", history: [], future: [], status: "", analysisResults: [], staleDatasets: [], recalcMode: "manual" });
});

describe("runTextToColumns", () => {
  it("adds a new worksheet in the source's book and leaves the source exactly as it was", async () => {
    const before = JSON.stringify(st().datasets[0]);
    const r = await runTextToColumns("w", "Cond", { delimiter: "semicolon" });
    expect(r).toEqual({ ok: true, created: 2, existing: false });
    expect(st().datasets).toHaveLength(2);
    expect(JSON.stringify(st().datasets[0])).toBe(before);
    const out = st().datasets[1];
    expect(out.workbookId).toBe("B");
    expect(out.data.labels).toEqual(["M", "Cond 2"]);
    expect(out.data.values).toEqual([[5, 0.1], [6, 0.2], [7, 0.3]]);
    expect((out.data.metadata.origin_text_columns as Record<string, string[]>).Cond_1).toEqual(["300 K", "310 K", "320 K"]);
  });

  it("is one undo step with its Library result", async () => {
    await runTextToColumns("w", "Cond", { delimiter: "semicolon" });
    expect(st().analysisResults).toHaveLength(1);
    expect(st().history).toHaveLength(1);
    st().undo();
    expect(st().datasets).toHaveLength(1);
    expect(st().analysisResults).toHaveLength(0);
  });

  it("a repeat adds nothing; different settings add a new output", async () => {
    await runTextToColumns("w", "Cond", { delimiter: "semicolon" });
    st().setActive("w");
    const again = await runTextToColumns("w", "Cond", { delimiter: "semicolon" });
    expect(again).toMatchObject({ ok: true, existing: true });
    expect(st().datasets).toHaveLength(2);
    st().setActive("w");
    await runTextToColumns("w", "Cond", { delimiter: "custom", custom: " K;" });
    expect(st().datasets).toHaveLength(3);
  });

  it("goes out of date when the source changes", async () => {
    await runTextToColumns("w", "Cond", { delimiter: "semicolon" });
    const outId = st().datasets[1].id;
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "w" ? { ...d, data: { ...d.data, time: [1, 2, 9] } } : d)) }));
    st().touchDataset("w");
    expect(st().staleDatasets).toEqual([outId]);
  });

  it("refuses with a reason and writes nothing: no such column, empty delimiter, still loading", async () => {
    expect(await runTextToColumns("w", "Nope", { delimiter: "comma" })).toMatchObject({ ok: false, error: expect.stringContaining("no longer") });
    expect(await runTextToColumns("w", "Cond", { delimiter: "custom", custom: "" })).toMatchObject({ ok: false, error: expect.stringContaining("delimiter") });
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, pending: { rows: 3, cols: 1 } as Dataset["pending"] })) }));
    expect(await runTextToColumns("w", "Cond", { delimiter: "comma" })).toMatchObject({ ok: false });
    expect(st().datasets).toHaveLength(1);
    expect(st().history).toHaveLength(0);
    expect(st().status).toContain("Text to columns");
  });
});
