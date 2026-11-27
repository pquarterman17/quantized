// Statistical tests workshop — column pickers and settings for the life-data
// tests (censored life distribution, Fit Life by X; GAP_AUDIT_9 G8). Every field
// label is also its accessible name. The censor column is 1 = censored.

import type { ReactNode } from "react";

import {
  LIFE_DISTS, LIFE_TRANSFORMS, effectiveLifeDist, type LifeParams,
} from "../../../lib/statsTestsLife";
import { LIFE_CI_OPTIONS, LIFE_PLOTTING_OPTIONS, selectOptions } from "../../../lib/statsTestsOptions";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Checkbox } from "../../primitives/Checkbox";
import { Select } from "../../primitives";
import type { StatsTestsState } from "./useStatsTests";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ flex: "1 1 110px", minWidth: 0 }}>
      <label className="qzk-field-lbl">{label}</label>
      {children}
    </div>
  );
}

const row = { display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" } as const;

export default function LifeInputs({ t }: { t: StatsTestsState }) {
  const p = t.params.life;
  const byX = t.testId === "life-by-x";
  const interval = t.testId === "life-interval";
  const set = (patch: Partial<LifeParams>) => t.setParams({ life: { ...p, ...patch } });
  const cols = t.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const pickCol = (label: string, value: number, onPick: (i: number) => void) => (
    <Field label={label}>
      <Select aria-label={label} options={cols} value={String(value)} onChange={(e) => onPick(Number(e.target.value))} />
    </Field>
  );
  const dists = LIFE_DISTS.filter((d) => !byX || d.id !== "sev").map((d) => ({ value: d.id, label: d.label }));
  const unit = LIFE_TRANSFORMS.find((x) => x.id === p.transform)?.unit;
  return (
    <>
      <div style={row}>
        {pickCol(interval ? "Lower bound (0 = left-censored)" : "Time", t.sel.x, (x) => t.setSel({ x }))}
        {pickCol(interval ? "Upper bound (blank = right-censored)" : "Censor (1 = censored, 0 = failed)", t.sel.y, (y) => t.setSel({ y }))}
        {byX && pickCol("Stress variable", t.sel.byCol, (byCol) => t.setSel({ byCol }))}
      </div>
      <div style={row}>
        <Field label="Distribution">
          <Select aria-label="Distribution" options={dists} value={effectiveLifeDist(t.testId, p)}
            onChange={(e) => set({ distribution: e.target.value as LifeParams["distribution"] })} />
        </Field>
        {byX && (
          <Field label="Relationship">
            <Select aria-label="Relationship" options={LIFE_TRANSFORMS.map((x) => ({ value: x.id, label: x.label }))} value={p.transform}
              onChange={(e) => set({ transform: e.target.value as LifeParams["transform"] })} />
          </Field>
        )}
        {byX && (
          <Field label={`Use condition${unit ? ` (${unit})` : ""}`}>
            <BufferedNumberField aria-label="Use condition" value={p.useX ?? undefined} width={96} onValue={(v) => set({ useX: v ?? null })} />
          </Field>
        )}
        {!byX && (
          <Field label="Interval method">
            <Select aria-label="Interval method"
              options={selectOptions(LIFE_CI_OPTIONS)}
              value={p.ciMethod} onChange={(e) => set({ ciMethod: e.target.value as LifeParams["ciMethod"] })} />
          </Field>
        )}
        {!byX && !interval && (
          <Field label="Plotting positions">
            <Select aria-label="Plotting positions"
              options={selectOptions(LIFE_PLOTTING_OPTIONS)}
              value={p.plotting} onChange={(e) => set({ plotting: e.target.value as LifeParams["plotting"] })} />
          </Field>
        )}
      </div>
      <div style={row}>
        <Field label="B-lives (%), e.g. 10 for B10">
          <input className="qz-input" aria-label="B-lives (%)" value={p.quantilesText} onChange={(e) => set({ quantilesText: e.target.value })} />
        </Field>
        {!byX && (
          <Field label="Failure probability at times">
            <input className="qz-input" aria-label="Failure probability at times" value={p.timesText} placeholder="e.g. 1000, 5000"
              onChange={(e) => set({ timesText: e.target.value })} />
          </Field>
        )}
      </div>
      {!byX && (
        <div style={{ marginTop: 8 }}>
          <Checkbox checked={p.compare} onChange={() => set({ compare: !p.compare })}>
            Compare all distributions (AICc, BIC)
          </Checkbox>
        </div>
      )}
    </>
  );
}
