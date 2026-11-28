// The CDF / ECDF plot's numbers computed IN THE BROWSER (plan item 20), for when the server cannot be reached.
// `POST /api/statplots/cdf` (`calc.statplots_cdf.cdf_series`) is the authority; this is its offline twin, the way
// `lib/plotdata.ts`'s `buildColumns` is the plot series' (`statsCdf` falls back to it on a network failure only,
// never on a server refusal). The two are pinned to one another by the shared wire fixture
// `tests/fixtures/wire/stat_cdf_local.json`, whose expected values the BACKEND computed with numpy and which a
// Python test regenerates (`tests/test_stat_cdf_local.py`), and a vitest compares this module's output to it.
//
// Same conventions as the server's (see `calc/statplots_cdf.py`): the ECDF is right-continuous with one step per
// DISTINCT finite value (ties make one taller step); the band is the DKW inequality
// `eps = sqrt(ln(2 / alpha) / (2 n))` clipped to [0, 1]; the domain is the pooled finite range padded by 5 % of its
// width each side (a constant sample gets +-0.5). A FITTED CDF needs scipy's maximum likelihood fit and is not
// available offline: the caller refuses it with a reason.

import type { CdfWire, CdfWireSeries, CdfY } from "./statCdf";

export const DKW_ALPHA = 0.05;
const MAX_COLUMNS = 64;

const finiteSorted = (v: readonly number[]): number[] => v.filter(Number.isFinite).sort((a, b) => a - b);

/** The DKW half-width of the `1 - alpha` band around an ECDF of `n` values. */
export const dkwEpsilon = (n: number, alpha = DKW_ALPHA): number => Math.sqrt(Math.log(2 / alpha) / (2 * n));

/** `columns` as `POST /api/statplots/cdf` answers for them with no fit; throws, as the server refuses, on a column
 *  with no finite value or a bad column count. */
export function cdfWireLocal(columns: readonly (readonly number[])[], y: CdfY = "proportion", band = false, alpha = DKW_ALPHA): CdfWire {
  if (!(columns.length >= 1 && columns.length <= MAX_COLUMNS)) throw new Error(`a CDF plot takes 1 to ${MAX_COLUMNS} columns`);
  const cols = columns.map(finiteSorted);
  if (cols.some((c) => c.length === 0)) throw new Error("every column needs at least one finite value");
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of cols) {
    lo = Math.min(lo, c[0]);
    hi = Math.max(hi, c[c.length - 1]);
  }
  const pad = hi > lo ? 0.05 * (hi - lo) : 0.5;
  const series = cols.map((v): CdfWireSeries => {
    const n = v.length;
    const scale = y === "count" ? n : 1;
    const x: number[] = [];
    const f: number[] = [];
    for (let i = 0; i < n; i++) {
      if (x.length > 0 && x[x.length - 1] === v[i]) f[f.length - 1] = (i + 1) / n;
      else {
        x.push(v[i]);
        f.push((i + 1) / n);
      }
    }
    const entry: CdfWireSeries = { n, x, y: f.map((b) => b * scale) };
    if (band) {
      const eps = dkwEpsilon(n, alpha);
      entry.band = {
        eps,
        lo: f.map((b) => Math.min(1, Math.max(0, b - eps)) * scale),
        hi: f.map((b) => Math.min(1, Math.max(0, b + eps)) * scale),
        lo0: 0,
        hi0: Math.min(eps, 1) * scale,
      };
    }
    return entry;
  });
  return { y, domain: [lo - pad, hi + pad], y_max: y === "count" ? Math.max(...cols.map((c) => c.length)) : 1, alpha, fit: null, series };
}
