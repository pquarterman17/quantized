// The per-plot control row of the G15 Stage (Plots2Stage.tsx): which columns
// and options each plot reads. Controls only; the request is plots2Request.ts.

import type { ReactNode } from "react";

import { Select } from "../../primitives";
import type { Plots2Kind } from "../../../lib/plots2Mode";
import type { AuxColumn } from "../ternary/auxColumns";
import { NO_CATEGORY, type Plots2Cmap, type Plots2Picks } from "./plots2Request";

const CMAPS = ["viridis", "magma", "gray", "rdbu"].map((v) => ({ value: v, label: v }));
const NORMALIZE = [
  { value: "minmax", label: "Min-max (0 to 1)" },
  { value: "zscore", label: "Z-score" },
];
// Scott's rule is a provisional default, owner to confirm (kept out of the label).
const BANDWIDTH = [
  { value: "scott", label: "Scott's rule (default)" },
  { value: "silverman", label: "Silverman's rule" },
];

const field = (label: string, control: ReactNode) => (
  <div style={{ minWidth: 110 }}>
    <label className="qzk-field-lbl">{label}</label>
    {control}
  </div>
);
const check = (label: string, on: boolean, set: (v: boolean) => void) => (
  <label className="qzk-field-lbl" style={{ alignSelf: "flex-end" }}>
    <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {label}
  </label>
);

export default function Plots2Controls({
  kind,
  columns,
  groupColumns,
  picks,
  setPick,
}: {
  kind: Plots2Kind;
  columns: AuxColumn[];
  /** `columns` plus the CSV text columns: what "Color by" and Pareto's category may name. */
  groupColumns: AuxColumn[];
  picks: Plots2Picks;
  setPick: (patch: Partial<Plots2Picks>) => void;
}) {
  const cols = columns.map((c) => ({ value: String(c.index), label: c.label || "X" }));
  const groupCols = groupColumns.map((c) => ({ value: String(c.index), label: c.label || "X" }));
  const pickCol = (label: string, title: string, key: "x" | "y" | "cat" | "val") =>
    field(title, <Select aria-label={label} options={key === "cat" ? (picks.cat === NO_CATEGORY ? [{ value: String(NO_CATEGORY), label: "(choose a column)" }, ...groupCols] : groupCols) : cols} value={String(picks[key])} onChange={(e) => setPick({ [key]: Number(e.target.value) })} />);
  const cmap = field("Colormap", <Select aria-label="Colormap" options={CMAPS} value={picks.cmap} onChange={(e) => setPick({ cmap: e.target.value as Plots2Cmap })} />);
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {kind === "parallel" && (
        <>
          <div style={{ minWidth: 160 }}>
            <label className="qzk-field-lbl">Axes (in order)</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {columns.map((c) => (
                <label key={c.index} className="qzk-field-lbl">
                  <input
                    type="checkbox"
                    aria-label={`Axis ${c.label || "X"}`}
                    checked={picks.cols.includes(c.index)}
                    onChange={(e) =>
                      setPick({
                        cols: e.target.checked
                          ? columns.map((k) => k.index).filter((i) => i === c.index || picks.cols.includes(i))
                          : picks.cols.filter((i) => i !== c.index),
                      })
                    }
                  />{" "}
                  {c.label || "X"}
                </label>
              ))}
            </div>
          </div>
          {field("Color by", <Select aria-label="Color by" options={[{ value: "", label: "(none)" }, ...groupCols]} value={picks.colorBy === null ? "" : String(picks.colorBy)} onChange={(e) => setPick({ colorBy: e.target.value === "" ? null : Number(e.target.value) })} />)}
          {field("Scale each axis", <Select aria-label="Scale each axis" options={NORMALIZE} value={picks.normalize} onChange={(e) => setPick({ normalize: e.target.value as Plots2Picks["normalize"] })} />)}
          {cmap}
        </>
      )}
      {(kind === "hexbin" || kind === "kde2d") && (
        <>
          {pickCol("X column", "X", "x")}
          {pickCol("Y column", "Y", "y")}
          {kind === "hexbin" ? (
            <>
              {field("Hexagons across", <input aria-label="Hexagons across" type="number" className="qz-input" min={5} max={200} value={picks.gridsize} onChange={(e) => setPick({ gridsize: Math.min(200, Math.max(5, Math.round(Number(e.target.value) || 30))) })} style={{ width: 80 }} />)}
              {check("log counts", picks.logCounts, (v) => setPick({ logCounts: v }))}
            </>
          ) : (
            <>
              {field("Bandwidth", <Select aria-label="Bandwidth" options={BANDWIDTH} value={picks.bandwidth} onChange={(e) => setPick({ bandwidth: e.target.value as Plots2Picks["bandwidth"] })} />)}
              {check("show points", picks.showPoints, (v) => setPick({ showPoints: v }))}
            </>
          )}
          {cmap}
        </>
      )}
      {kind === "pareto" && (
        <>
          {pickCol("Category column", "Category", "cat")}
          {pickCol("Value column", "Value", "val")}
        </>
      )}
      {kind === "blandAltman" && (
        <>
          {pickCol("Method A column", "Method A", "x")}
          {pickCol("Method B column", "Method B", "y")}
          {check("percent differences", picks.percent, (v) => setPick({ percent: v }))}
          {check("show 95% CI bands", picks.showCi, (v) => setPick({ showCi: v }))}
        </>
      )}
    </div>
  );
}
