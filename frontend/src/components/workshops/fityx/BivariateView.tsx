// Fit Y by X — bivariate leg's view: continuous X x continuous Y. A scatter
// + fit-line SVG (modest — Graph Builder is the publication-plot path) and
// the coefficient/R2/F table from /api/stats/regression. No confidence band:
// lin_regress doesn't return one (see calc/stats.py's docstring) and this
// workbench doesn't add new backend.

import { fmtNum } from "../../../lib/format";
import { DataTable } from "../../primitives";
import type { BivariateResult } from "./useFitYByX";

const W = 320;
const H = 160;
const PAD = 8;

export default function BivariateView({ result }: { result: BivariateResult }) {
  const { x, y, order, regression } = result;
  const coeffs = (regression.coeffs as number[] | undefined) ?? [];
  const yFit = (regression.yFit as number[] | undefined) ?? [];

  const xLo = Math.min(...x);
  const xHi = Math.max(...x);
  const yAll = [...y, ...yFit].filter(Number.isFinite);
  const yLo = Math.min(...yAll);
  const yHi = Math.max(...yAll);
  const sx = (v: number) => (xHi > xLo ? PAD + ((v - xLo) / (xHi - xLo)) * (W - 2 * PAD) : W / 2);
  const sy = (v: number) => (yHi > yLo ? H - PAD - ((v - yLo) / (yHi - yLo)) * (H - 2 * PAD) : H / 2);

  // Fit line/curve: pair (x, yFit) and sort by x so a poly curve draws cleanly.
  const fitPoints = x
    .map((xv, i) => [xv, yFit[i]] as [number, number])
    .filter(([, fv]) => Number.isFinite(fv))
    .sort((a, b) => a[0] - b[0]);
  const linePath = fitPoints.map(([xv, fv], i) => `${i === 0 ? "M" : "L"}${sx(xv)},${sy(fv)}`).join(" ");

  return (
    <>
      <svg
        role="img"
        aria-label="bivariate scatter with fit"
        width={W}
        height={H}
        style={{ marginTop: 8, background: "var(--surface-3)" }}
      >
        {x.map((xv, i) => (
          <circle key={i} cx={sx(xv)} cy={sy(y[i])} r={2} fill="var(--text-faint)" />
        ))}
        {linePath && <path d={linePath} stroke="var(--accent)" strokeWidth={1.5} fill="none" />}
      </svg>

      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <DataTable
          columns={["N", "order", "intercept", "slope", "R²", "F", "p"]}
          rows={[[
            String(regression.N),
            String(order),
            fmtNum(coeffs[0]),
            fmtNum(coeffs[1]),
            fmtNum(regression.R2),
            fmtNum(regression.fStat),
            fmtNum(regression.fPvalue),
          ]]}
        />
      </div>
      {order > 1 && coeffs.length > 2 && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
          higher-order coefficients: {coeffs.slice(2).map((c) => fmtNum(c)).join(", ")}
        </div>
      )}
    </>
  );
}
