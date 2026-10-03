// SIMS depth profiles slice 2 (PRIMARY_SOFTWARE_AUDIT_PLAN P2.3, boxes 3-4),
// end to end against the real `/api/sims/compare`, `/api/sims/region` and
// figure export: two profiles (the second with its columns in the other
// order) are compared on one log-y plot with a one-decade stagger; the canvas
// legend states the offset, and the publication export built from the SAME
// view carries the same offsets and renders the same legend text; the region
// measures come back from the backend and export as a provenance CSV.

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

type Snap = {
  activeId: string | null;
  yScale: string;
  seriesStyles: Record<number, { logOffset?: number }>;
  datasets: { id: string; name: string; data: { labels: string[]; time: number[] } }[];
  macroSteps: { kind: string; params: Record<string, unknown> }[];
};
type Qz = { __qz: { useApp: { getState: () => Snap & Record<string, (...a: unknown[]) => void>; setState: (p: object) => void } } };

const snap = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Qz).__qz.useApp.getState();
    return JSON.parse(JSON.stringify({
      activeId: s.activeId, yScale: s.yScale, seriesStyles: s.seriesStyles, datasets: s.datasets, macroSteps: s.macroSteps,
    })) as Snap;
  });

async function seedProfiles(page: Page): Promise<void> {
  await page.evaluate(() => {
    const meta = { x_column_name: "Depth", x_column_unit: "nm", technique: "sims" };
    const st = (window as unknown as Qz).__qz.useApp.getState();
    st.addDataset({
      id: "e2e-a", name: "sampleA.csv",
      data: { time: [0, 10, 20, 30, 40], values: [[1e18, 5e22], [3e18, 5e22], [5e18, 5e22], [3e18, 5e22], [1e18, 5e22]], labels: ["B", "Si"], units: ["atoms/cm3", "atoms/cm3"], metadata: meta },
    });
    st.addDataset({
      id: "e2e-b", name: "sampleB.csv",
      data: { time: [0, 20, 40], values: [[5e22, 2e18], [5e22, 4e18], [5e22, 2e18]], labels: ["Si", "B"], units: ["atoms/cm3", "atoms/cm3"], metadata: meta },
    });
    st.startMacro();
    (window as unknown as Qz).__qz.useApp.setState({ selectedIds: ["e2e-a", "e2e-b"] });
  });
  await waitForDatasetCount(page, 2);
}

test.describe("SIMS compare + region (P2.3 slice 2)", () => {
  test("compare two profiles with a decade stagger; canvas and export agree; region CSV", async ({ page }) => {
    await gotoApp(page);
    await seedProfiles(page);

    await runPaletteCommand(page, "SIMS depth profile…");
    const panel = page.locator(".qzk-win").filter({ hasText: "SIMS depth profile" });
    await panel.getByRole("radio", { name: "Compare" }).click();
    await panel.getByRole("group", { name: "Species" }).getByRole("checkbox", { name: "Si" }).uncheck();
    await panel.getByRole("textbox", { name: "Stagger (decades per trace)" }).fill("1");
    const preview = panel.getByRole("group", { name: "Comparison preview" });
    await expect(preview).toContainText("2 traces · 8 rows");
    await expect(preview).toContainText("B — sampleB ×10^1");
    expect((await snap(page)).datasets).toHaveLength(2); // the preview created nothing

    await panel.getByRole("button", { name: "Create comparison" }).click();
    await waitForDatasetCount(page, 3);
    const s = await snap(page);
    const made = s.datasets.find((d) => d.name === "sampleA + 1 (SIMS comparison)")!;
    expect(made.data.labels).toEqual(["B — sampleA", "B — sampleB"]);
    expect(made.data.time).toEqual([0, 10, 20, 30, 40, 0, 20, 40]);
    expect(s.activeId).toBe(made.id);
    expect(s.yScale).toBe("log");
    expect(s.seriesStyles).toEqual({ 0: { logOffset: 0 }, 1: { logOffset: 1 } });
    // finding 7 (review fix): the stagger's raw `yScale: "log"` write now
    // also records the SAME macro step `setYScale("log")` would, right after
    // the `simscompare` transform step, so a replay switches the axis too.
    expect(s.macroSteps.map((m) => [m.kind, m.params.op, m.params.species])).toEqual([
      ["transform", "simscompare", ["B"]],
      ["ui", undefined, undefined],
    ]);

    // The canvas legend states the offset (suffix before the unit).
    await expect(page.locator(".qzk-stage")).toContainText("B — sampleB ×10^1 (atoms/cm³)");

    // The publication export of this same view carries the same offsets…
    const hitmap = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/export/figure-hitmap");
    await runPaletteCommand(page, "Publication preview…");
    const response = await hitmap;
    expect(response.ok()).toBe(true);
    const spec = response.request().postDataJSON() as Record<string, unknown>;
    expect(spec.y_keys).toEqual([0, 1]);
    expect(spec.log_offsets).toEqual([0, 1]);
    expect(spec.y_scale).toBe("log");
    await page.keyboard.press("Escape");
    // …and renders the same legend text in the vector file (posted once the
    // preview's own renders are done).
    const svg = await page.request.post("/api/export/figure", { data: { ...spec, fmt: "svg" } });
    expect(svg.ok(), await svg.text()).toBe(true);
    const text = await svg.text();
    expect(text).toContain("B — sampleB ×10^1 (atoms/cm³)");
    expect(text).toContain("B — sampleA (atoms/cm³)");

    // Region measures on sample A, from the real backend.
    await panel.getByRole("radio", { name: "Region" }).click();
    await panel.getByRole("combobox", { name: "Region profile" }).selectOption({ label: "sampleA.csv" });
    await panel.getByRole("group", { name: "Region species" }).getByRole("checkbox", { name: "Si" }).uncheck();
    const measures = panel.getByRole("group", { name: "Region measures" });
    // (1+3)/2*10 + (3+5)/2*10 + (5+3)/2*10 + (3+1)/2*10 = 120e18 atoms/cm3·nm = 1.2e13 atoms/cm2
    await expect(measures).toContainText("1.200e+13 atoms/cm^2");
    // The junction (metallurgical-junction convention) is the falling
    // crossing beyond the peak (20 nm): 32.5 nm, not the shallower leading
    // (rising) edge at 7.5 nm -- see calc.sims_region's junction doc.
    await expect(measures).toContainText("32.5");
    const download = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Export CSV" }).click();
    const csv = await readFile((await (await download).path())!, "utf8");
    expect(csv).toContain("# dataset: sampleA.csv");
    expect(csv).toContain("# region: Depth 0 to 40 nm (inclusive");
    expect(csv).toMatch(/\nB,atoms\/cm3,5,0,1\.2e\+13,atoms\/cm\^2,areal-dose,/);
  });
});
