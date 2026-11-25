// Blocking (2-level factorials) and D-optimal options of the DOE form
// (GAP_AUDIT_9 J16 leftovers). Choices are provisional, owner to confirm: the
// standard block generators maximise the lowest order of any confounded
// effect; D-optimal grids are 2 levels (3 for the quadratic model).

import { Select } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import type { DoeState } from "./useDoe";

const hint = { color: "var(--text-faint)" } as const;
const BLOCKS = [1, 2, 4, 8, 16].map((n) => ({ value: String(n), label: n === 1 ? "No blocks" : `${n} blocks` }));
const MODELS = [
  { value: "main", label: "Main effects" },
  { value: "interaction", label: "Main effects + 2-factor interactions" },
  { value: "quadratic", label: "Quadratic (response surface)" },
];
const METHODS = [
  { value: "coordinate", label: "Coordinate exchange" },
  { value: "fedorov", label: "Fedorov exchange (candidate grid)" },
];

export function BlockingOptions({ d }: { d: DoeState }) {
  const { setup: s, update } = d;
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div>
        <label className="qzk-field-lbl" htmlFor="doe-blocks">Blocking</label>
        <Select id="doe-blocks" aria-label="Blocks" options={BLOCKS} value={s.blocks} onChange={(e) => update({ blocks: e.target.value })} />
      </div>
      {s.blocks !== "1" && (
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="qzk-field-lbl" htmlFor="doe-block-gens">Block generators (blank = standard)</label>
          <input id="doe-block-gens" aria-label="Block generators" className="qz-input" placeholder="e.g. ABC, BCD" value={s.blockGens}
            onChange={(e) => update({ blockGens: e.target.value })} />
        </div>
      )}
      {s.blocks !== "1" && (
        <div className="qzk-ds-meta" style={{ ...hint, flexBasis: "100%" }}>
          The generators (and their products) are confounded with blocks and cannot be estimated; the worksheet gets a Block column,
          and Analyze design fits Block as a fixed effect.
        </div>
      )}
    </div>
  );
}

export function OptimalOptions({ d }: { d: DoeState }) {
  const { setup: s, update } = d;
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div>
        <label className="qzk-field-lbl" htmlFor="doe-opt-model">Model</label>
        <Select id="doe-opt-model" aria-label="Model" options={MODELS} value={s.optModel} onChange={(e) => update({ optModel: e.target.value as typeof s.optModel })} />
      </div>
      <div>
        <label className="qzk-field-lbl" htmlFor="doe-opt-runs">Runs</label>
        <NumberField id="doe-opt-runs" aria-label="Number of runs" value={s.nRuns} width={56} onChange={(v) => update({ nRuns: v })} />
      </div>
      <div>
        <label className="qzk-field-lbl" htmlFor="doe-opt-method">Method</label>
        <Select id="doe-opt-method" aria-label="Method" options={METHODS} value={s.method} onChange={(e) => update({ method: e.target.value as typeof s.method })} />
      </div>
      <div>
        <label className="qzk-field-lbl" htmlFor="doe-opt-grid">Levels per factor</label>
        <NumberField id="doe-opt-grid" aria-label="Levels per factor" value={s.gridLevels} width={56} placeholder={s.optModel === "quadratic" ? "3" : "2"}
          onChange={(v) => update({ gridLevels: v })} />
      </div>
      <div>
        <label className="qzk-field-lbl" htmlFor="doe-opt-seed">Seed</label>
        <NumberField id="doe-opt-seed" aria-label="Seed" value={s.optSeed} width={72} onChange={(v) => update({ optSeed: v })} />
      </div>
      <div className="qzk-ds-meta" style={{ ...hint, flexBasis: "100%" }}>
        Picks the runs that maximize det(X'X) for the model, from random starts with a fixed seed (also used to shuffle the run order), and reports the D-efficiency.
        Give a factor a comma-separated list of levels (e.g. air, N2, Ar) to make it categorical.
      </div>
    </div>
  );
}
