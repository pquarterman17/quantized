// Analysis — Average multiple curves (origin gap audit 2 #9, #658), end to
// end against the real backend: the Command Palette opens Dataset Math on
// its "Average N" tab, two picked datasets average onto the union of their
// X, and the result is a linked dataset with mean/SD/SEM/N columns, SEM
// bound as the mean's Y error. See docs/theory/analysis.md for the formulas
// this checks against (SEM = SD / sqrt(N)).

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface StoreSnapshot {
  count: number;
  names: string[];
  last: {
    name: string;
    labels: string[];
    units: string[];
    time: number[];
    cols: number[][];
    errorRoles: { channel: number; target: number; axis: string; side: string }[];
  };
}

type QzWindow = {
  __qz: {
    useApp: {
      getState: () => {
        datasets: {
          id: string;
          name: string;
          errorRoles?: { channel: number; target: number; axis: string; side: string }[];
          data: { time: number[]; labels: string[]; units: string[]; values: (number | null)[][] };
        }[];
      };
    };
  };
};

const store = (page: Page): Promise<StoreSnapshot> =>
  page.evaluate(() => {
    const ds = (window as unknown as QzWindow).__qz.useApp.getState().datasets;
    const last = ds[ds.length - 1];
    return {
      count: ds.length,
      names: ds.map((d) => d.name),
      last: {
        name: last.name,
        labels: last.data.labels,
        units: last.data.units,
        time: last.data.time,
        cols: last.data.labels.map((_, c) => last.data.values.map((row) => Number(row[c]))),
        errorRoles: last.errorRoles ?? [],
      },
    };
  });

test("Average multiple curves: two datasets -> one linked mean/SD/SEM/N dataset, SEM bound as the error", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  const library = page.locator(".qzk-library");
  await dropFileOnto(page, library, fixturePath("dataset-a.csv"));
  await waitForDatasetCount(page, 1);
  await dropFileOnto(page, library, fixturePath("dataset-b.csv"));
  await waitForDatasetCount(page, 2);

  await runPaletteCommand(page, "Average multiple curves…");
  await expect(page.getByRole("radio", { name: "Average N" })).toBeChecked();

  // Pick both datasets (the panel seeds from the Library selection, which a
  // plain sequential drop never set to both — tick whichever isn't already).
  for (const name of ["dataset-a.csv", "dataset-b.csv"]) {
    const box = page.getByRole("checkbox", { name });
    if (!(await box.isChecked())) await box.check();
  }
  await expect(page.getByRole("checkbox", { name: "dataset-a.csv" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "dataset-b.csv" })).toBeChecked();

  // Union of x (the default) over two curves that already share every x —
  // every grid point should average both (N = 2 everywhere).
  await expect(page.getByRole("radio", { name: "Union of x" })).toBeChecked();

  await page.getByRole("button", { name: /Average → new dataset/ }).click();
  await waitForDatasetCount(page, 3);

  const s = await store(page);
  expect(s.count).toBe(3);
  expect(s.last.labels).toEqual(["Value mean", "Value SD", "Value SEM", "N"]);
  // SEM is bound as the mean column's (channel 0) Y error (docs/theory/analysis.md).
  expect(s.last.errorRoles).toEqual([{ channel: 2, target: 0, axis: "y", side: "both" }]);

  // x = 0: dataset-a 1.0, dataset-b 3.0 -> mean 2.0, SD sqrt(2) ~= 1.41421,
  // SEM = SD / sqrt(2) = 1.0 exactly (calc/curve_average.py's _stats).
  const i0 = s.last.time.indexOf(0);
  expect(s.last.cols[0][i0]).toBeCloseTo(2.0, 6);
  expect(s.last.cols[1][i0]).toBeCloseTo(Math.sqrt(2), 6);
  expect(s.last.cols[2][i0]).toBeCloseTo(1.0, 6);
  expect(s.last.cols[3][i0]).toBe(2);

  // x = 3: both curves read 2.1 -> SD and SEM collapse to 0, not NaN.
  const i3 = s.last.time.indexOf(3);
  expect(s.last.cols[0][i3]).toBeCloseTo(2.1, 6);
  expect(s.last.cols[1][i3]).toBeCloseTo(0, 9);
  expect(s.last.cols[2][i3]).toBeCloseTo(0, 9);
  expect(s.last.cols[3][i3]).toBe(2);

  // Every point averaged both curves: full overlap, union grid == every x.
  expect(s.last.cols[3].every((n) => n === 2)).toBe(true);
});
