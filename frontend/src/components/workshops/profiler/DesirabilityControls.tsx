// Desirability (JMP Prediction Profiler > Optimization and Desirability), the
// small single-response form: a goal (maximize, minimize, match target), the
// limits, a readout of d at the current settings, and "Maximize desirability"
// (a grid search on the server: calc/profile_desirability.py). Provisional,
// owner to confirm: linear desirability shapes, one response, grid search.

import { fmtNum } from "../../../lib/format";
import { Button, Select } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Checkbox } from "../../primitives/Checkbox";
import type { GoalDraft, ProfilerState } from "./useProfiler";

export default function DesirabilityControls({ p }: { p: ProfilerState }) {
  const { goal, setGoal, goalSpec } = p;
  const set = (patch: Partial<GoalDraft>) => setGoal({ ...goal, ...patch });
  const num = (label: string, key: "lower" | "upper" | "target") => (
    <label className="qz-k">{label}
      <BufferedNumberField aria-label={`Desirability ${label.toLowerCase()}`} value={goal[key]} required width={72}
        onValue={(v) => { if (v !== undefined) set({ [key]: v }); }} />
    </label>
  );
  const d = p.profile?.current.desirability;
  return (
    <div className="qz-profiler-desirability">
      <Checkbox checked={goal.on} onChange={(on) => {
        // First time on: seed the limits around the current prediction (+/- 3 RMSE).
        const cur = p.profile?.current;
        const fresh = goal.lower === 0 && goal.upper === 1;
        if (!on || !cur || !fresh) return set({ on });
        const r = (v: number) => Number(fmtNum(v));
        set({ on, lower: r(cur.predicted - 3 * p.profile!.rmse), upper: r(cur.predicted + 3 * p.profile!.rmse), target: r(cur.predicted) });
      }}>Desirability</Checkbox>
      {goal.on && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <label className="qz-k">Goal
            <Select aria-label="Desirability goal" value={goal.goal} onChange={(e) => set({ goal: e.target.value as GoalDraft["goal"] })}
              options={[{ value: "maximize", label: "Maximize" }, { value: "minimize", label: "Minimize" }, { value: "target", label: "Match target" }]} />
          </label>
          {num("Lower", "lower")}
          {goal.goal === "target" && num("Target", "target")}
          {num("Upper", "upper")}
          <Button size="sm" disabled={!goalSpec} onClick={p.maximize}
            title={goalSpec ? undefined : "Set limits with lower < upper (and lower < target < upper)"}>
            Maximize desirability
          </Button>
          <span className="qz-k" aria-live="polite">Desirability {d === undefined ? "–" : fmtNum(d)}</span>
        </div>
      )}
    </div>
  );
}
