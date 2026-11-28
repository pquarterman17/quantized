// Clustering tab: user-specified starting centres for k-means (Origin's `kmeans`
// takes initial centres). Two entry modes, both pure and both fail-closed with a
// reason: pick k worksheet rows (their values become the centres), or enter /
// paste a k x p table (one line per cluster, values in the order of the picked
// columns, separated by tabs, commas, semicolons or spaces). Centres are in the
// data's own units; the backend scales them with the data.

export type ClusterStart = "auto" | "rows" | "table";

export type Centres = { problem: string } | { problem: null; centres: number[][] };

const SPLIT = /[\t,;\s]+/;

/** A pasted table: exactly `k` lines of `p` finite numbers. */
export function parseCentreTable(text: string, k: number, p: number): Centres {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) return { problem: `Enter the ${k} starting centres: one line per cluster, ${p} values per line.` };
  const centres: number[][] = [];
  for (const [i, line] of lines.entries()) {
    const cells = line.split(SPLIT).filter((c) => c !== "");
    const values = cells.map(Number);
    if (values.some((v) => !Number.isFinite(v))) return { problem: `Centre ${i + 1} has a value that is not a number.` };
    if (values.length !== p) return { problem: `Centre ${i + 1} has ${values.length} value${values.length === 1 ? "" : "s"}; one per picked column (${p}) is needed.` };
    centres.push(values);
  }
  if (centres.length !== k) return { problem: `The centre table has ${centres.length} line${centres.length === 1 ? "" : "s"}; k = ${k} needs one per cluster.` };
  return distinct(centres);
}

/** `k` worksheet row numbers (1-based, as the worksheet shows them) whose values are the centres. */
export function pickRowCentres(text: string, k: number, sourceRows: readonly number[], rows: readonly (readonly number[])[]): Centres {
  const cells = text.split(SPLIT).filter((c) => c !== "");
  if (cells.length === 0) return { problem: `Enter ${k} worksheet row numbers to start from, for example 1, 12, 30.` };
  const picked = cells.map(Number);
  if (picked.some((r) => !Number.isInteger(r) || r < 1)) return { problem: "Start rows must be whole worksheet row numbers, 1 or more." };
  if (picked.length !== k) return { problem: `${picked.length} start row${picked.length === 1 ? "" : "s"} entered; k = ${k} needs exactly ${k}.` };
  if (new Set(picked).size !== k) return { problem: "Start rows must be different rows." };
  const centres: number[][] = [];
  for (const r of picked) {
    const at = sourceRows.indexOf(r);
    if (at < 0) return { problem: `Row ${r} is not one of the clustered rows (it is excluded, masked, filtered out, blank in a picked column, or does not exist).` };
    centres.push([...rows[at]]);
  }
  return distinct(centres);
}

function distinct(centres: number[][]): Centres {
  const seen = new Set(centres.map((c) => c.join("\u0000")));
  return seen.size === centres.length ? { problem: null, centres } : { problem: "The starting centres must be different from each other." };
}
