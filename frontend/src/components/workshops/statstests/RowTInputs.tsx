// Statistical tests workshop — pickers for the row-wise t-tests. Group A is
// `sel.cols`; group B is `params.rowt.groupB`. Each row of the worksheet is
// tested on its own, so a group is the replicate columns across a row. The
// variance model is always an explicit choice (Student pooled, as Origin does,
// or Welch). Every label is also its accessible name.

import { ROWT_ADJUSTMENTS } from "../../../lib/rowTestWorksheet";
import { ROWT_DESIGNS, ROWT_VARIANCES, type RowTParams } from "../../../lib/statsTestsRows";
import { Select } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Checkbox } from "../../primitives/Checkbox";
import type { StatsTestsState } from "./useStatsTests";

const faint = { color: "var(--text-faint)" } as const;
const list = { display: "flex", flexDirection: "column", gap: 2, maxHeight: 130, overflowY: "auto" } as const;

const toggle = (xs: number[], c: number): number[] => (xs.includes(c) ? xs.filter((v) => v !== c) : [...xs, c]);

export default function RowTInputs({ t }: { t: StatsTestsState }) {
  const rt = t.params.rowt;
  const set = (patch: Partial<RowTParams>) => t.setParams({ rowt: { ...rt, ...patch } });
  const numeric = t.columns.filter((c) => !c.categorical);
  return (
    <>
      <div style={{ marginTop: 8 }}>
        <label className="qzk-field-lbl">Design</label>
        <Select aria-label="Design" options={ROWT_DESIGNS.map((d) => ({ value: d.id, label: d.label }))} value={rt.design}
          onChange={(e) => set({ design: e.target.value as RowTParams["design"] })} />
      </div>
      {rt.design === "two-sample" && (
        <div style={{ marginTop: 8 }}>
          <label className="qzk-field-lbl">Variance model</label>
          <Select aria-label="Variance model" options={ROWT_VARIANCES.map((v) => ({ value: v.id, label: v.label }))} value={rt.variance}
            onChange={(e) => set({ variance: e.target.value as RowTParams["variance"] })} />
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <div className="qzk-field-lbl">Group A columns</div>
        <div className="qzk-ds-meta" style={faint}>The replicates across each row (numeric columns).</div>
        <div style={list} role="group" aria-label="Group A columns">
          {numeric.map((c) => (
            <Checkbox key={c.index} checked={t.sel.cols.includes(c.index)} onChange={() => t.toggleCol(c.index)}>{c.label}</Checkbox>
          ))}
        </div>
      </div>
      {rt.design !== "one-sample" && (
        <div style={{ marginTop: 8 }}>
          <div className="qzk-field-lbl">Group B columns</div>
          {rt.design === "paired" && <div className="qzk-ds-meta" style={faint}>Same number as A; column k of A pairs with column k of B, in worksheet order.</div>}
          <div style={list} role="group" aria-label="Group B columns">
            {numeric.map((c) => (
              <Checkbox key={c.index} checked={rt.groupB.includes(c.index)} onChange={() => set({ groupB: toggle(rt.groupB, c.index) })}>{c.label}</Checkbox>
            ))}
          </div>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <label className="qzk-field-lbl">Null value</label>
        <BufferedNumberField aria-label="Null value" value={rt.mu} width={72} onValue={(v) => v != null && set({ mu: v })} />
        <div className="qzk-ds-meta" style={faint}>
          {rt.design === "one-sample" ? "The mean each row is compared with." : "The difference of means under the null (usually 0)."}
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="qzk-field-lbl">P-value adjustment</label>
        <Select aria-label="P-value adjustment" options={ROWT_ADJUSTMENTS.map((a) => ({ value: a.id, label: a.label }))} value={rt.adjust}
          onChange={(e) => set({ adjust: e.target.value as RowTParams["adjust"] })} />
        <div className="qzk-ds-meta" style={faint}>Adds an adjusted-p column for testing every row; the raw p is always kept.</div>
      </div>
    </>
  );
}
