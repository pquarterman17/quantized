// Statistical tests workshop — pickers for response screening (GAP_AUDIT_9 G26).
// Responses (Y) are `sel.cols`; factors (X) are `params.screen.xCols`. A
// categorical worksheet column is always a nominal factor; a numeric one can be
// marked nominal (a lot number, a recipe code). Every label is also its
// accessible name.

import { SCREEN_METHODS, type ScreenParams } from "../../../lib/statsTestsScreen";
import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { StatsTestsState } from "./useStatsTests";

const faint = { color: "var(--text-faint)" } as const;
const list = { display: "flex", flexDirection: "column", gap: 2, maxHeight: 140, overflowY: "auto" } as const;

const toggle = (xs: number[], c: number): number[] => (xs.includes(c) ? xs.filter((v) => v !== c) : [...xs, c]);

export default function ScreenInputs({ t }: { t: StatsTestsState }) {
  const sc = t.params.screen;
  const set = (patch: Partial<ScreenParams>) => t.setParams({ screen: { ...sc, ...patch } });
  return (
    <>
      <div style={{ marginTop: 8 }}>
        <div className="qzk-field-lbl">Responses (Y), numeric</div>
        <div style={list} role="group" aria-label="Responses (Y)">
          {t.columns.filter((c) => !c.categorical).map((c) => (
            <Checkbox key={c.index} checked={t.sel.cols.includes(c.index)} onChange={() => t.toggleCol(c.index)}>{c.label}</Checkbox>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <div className="qzk-field-lbl">Factors (X)</div>
        <div className="qzk-ds-meta" style={faint}>Continuous: regression. Nominal: t-test (2 levels) or ANOVA.</div>
        <div style={list} role="group" aria-label="Factors (X)">
          {t.columns.map((c) => (
            <div key={c.index} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Checkbox checked={sc.xCols.includes(c.index)} onChange={() => set({ xCols: toggle(sc.xCols, c.index) })}>{c.label}</Checkbox>
              {sc.xCols.includes(c.index) && (c.categorical
                ? <span className="qzk-ds-meta" style={faint}>nominal</span>
                : <Checkbox checked={sc.nominalCols.includes(c.index)} onChange={() => set({ nominalCols: toggle(sc.nominalCols, c.index) })}>
                  <span aria-label={`${c.label} is nominal`}>nominal</span>
                </Checkbox>)}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="qzk-field-lbl">Adjustment</label>
        <Select aria-label="Adjustment" options={SCREEN_METHODS.map((m) => ({ value: m.id, label: m.label }))} value={sc.method}
          onChange={(e) => set({ method: e.target.value as ScreenParams["method"] })} />
      </div>
    </>
  );
}
