// Statistical tests workshop — pickers for the seasonal Mann-Kendall trend test:
// time, values, and where the season comes from (a column of season labels, or a
// period P with the season = the time index modulo P). Every label is also its
// accessible name. Settings live in `params.rowt` (lib/statsTestsSeasonal.ts).

import { SEASON_FROM, MAX_PERIOD, type SeasonFrom } from "../../../lib/statsTestsSeasonal";
import type { RowTParams } from "../../../lib/statsTestsRows";
import { Select } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import type { StatsTestsState } from "./useStatsTests";

const faint = { color: "var(--text-faint)" } as const;
const row = { display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" } as const;

export default function SeasonalInputs({ t }: { t: StatsTestsState }) {
  const rt = t.params.rowt;
  const set = (patch: Partial<RowTParams>) => t.setParams({ rowt: { ...rt, ...patch } });
  const opts = t.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const pick = (label: string, value: number, onPick: (i: number) => void) => (
    <div style={{ flex: "1 1 110px", minWidth: 0 }}>
      <label className="qzk-field-lbl">{label}</label>
      <Select aria-label={label} options={opts} value={String(value)} onChange={(e) => onPick(Number(e.target.value))} />
    </div>
  );
  return (
    <>
      <div style={row}>
        {pick("Time (x)", t.sel.x, (x) => t.setSel({ x }))}
        {pick("Values (y)", t.sel.y, (y) => t.setSel({ y }))}
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="qzk-field-lbl">Season from</label>
        <Select aria-label="Season from" options={SEASON_FROM.map((s) => ({ value: s.id, label: s.label }))} value={rt.seasonFrom}
          onChange={(e) => set({ seasonFrom: e.target.value as SeasonFrom })} />
      </div>
      {rt.seasonFrom === "column" ? (
        <div style={row}>{pick("Season column", t.sel.byCol, (byCol) => t.setSel({ byCol }))}</div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <label className="qzk-field-lbl">Period P</label>
          <BufferedNumberField aria-label="Period" value={rt.period} width={72} onValue={(v) => v != null && Number.isInteger(v) && v >= 2 && v <= MAX_PERIOD && set({ period: v })} />
          <div className="qzk-ds-meta" style={faint}>Observations per cycle (12 for monthly data): the time must be the observation index 0, 1, 2, ...</div>
        </div>
      )}
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 8 }}>
        Each season needs at least 2 years; thinner seasons are left out and listed. The seasons are treated as independent (no covariance correction for serial correlation between seasons).
      </div>
    </>
  );
}
