// Prediction profiler and contour profiler (GAP_AUDIT_9 G7, JMP Profiler:
// https://www.jmp.com/support/help/en/18.0/jmp/profiler-2.shtml). Evaluates a
// FITTED Fit Model (no refit): the model Fit Model hands over, or a saved Fit
// Model result's `parameters.model`. One panel per factor (FactorTrace), the
// current prediction with its confidence interval, an optional contour
// (ContourProfile) and desirability. Numbers: calc/profile_model.py.

import { useState } from "react";

import { fmtNum } from "../../../lib/format";
import { useProfilerStore } from "../../../store/profiler";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import ContourProfile from "./ContourProfile";
import DesirabilityControls from "./DesirabilityControls";
import FactorTrace from "./FactorTrace";
import ProfilerResultBook from "./ProfilerResultBook";
import { useProfiler } from "./useProfiler";

export function ProfilerPanel() {
  const setOpen = useProfilerStore((s) => s.setOpen);
  const p = useProfiler();
  const [view, setView] = useState<"prediction" | "contour">("prediction");
  const note = (text: string, warn = false) => (
    <div className="qzk-ds-meta" role={warn ? "alert" : undefined}
      style={{ marginTop: 10, color: warn ? "var(--warn)" : "var(--text-faint)" }}>{text}</div>
  );
  const prof = p.profile;
  const level = `${fmtNum((1 - p.alpha) * 100)}%`;
  let yLo = Infinity, yHi = -Infinity;
  for (const t of prof?.factors ?? []) for (let i = 0; i < t.lower.length; i++) {
    yLo = Math.min(yLo, t.lower[i]!); yHi = Math.max(yHi, t.upper[i]!);
  }
  return (
    <ToolWindow id="profiler" title="Profiler" width={640} onClose={() => setOpen(false)}>
      {!p.model ? note("Fit a model with Fit Model, then press Profiler in its result, or save a Fit Model result to profile it here.") : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label className="qz-k">Model
              <Select aria-label="Profiled model" value={p.sourceId} onChange={(e) => p.setSourceId(e.target.value)}
                options={p.sources.map((s) => ({ value: s.id, label: s.label }))} />
            </label>
            <label className="qz-k">Confidence
              <Select aria-label="Confidence level" value={String(p.alpha)} onChange={(e) => p.setAlpha(Number(e.target.value))}
                options={[{ value: "0.1", label: "90%" }, { value: "0.05", label: "95%" }, { value: "0.01", label: "99%" }]} />
            </label>
            <Button size="sm" onClick={p.reset}>Reset settings</Button>
            <div role="tablist" aria-label="Profiler view" style={{ display: "inline-flex", gap: 4 }}>
              {(["prediction", "contour"] as const).map((v) => (
                <Button key={v} size="sm" role="tab" aria-selected={view === v} variant={view === v ? "primary" : undefined}
                  onClick={() => setView(v)}>{v === "prediction" ? "Prediction" : "Contour"}</Button>
              ))}
            </div>
          </div>
          {p.problem && note(p.problem, true)}
          {!p.problem && (
            <>
              <div className="qz-k" role="status" aria-live="polite" data-testid="profiler-readout"
                aria-busy={p.stale} style={{ margin: "8px 0", fontFamily: "var(--font-mono)", opacity: p.stale ? 0.6 : 1 }}>
                {prof
                  ? `${prof.response} = ${fmtNum(prof.current.predicted)} ± ${fmtNum(prof.t_crit * prof.current.se)} (${level} CI ${fmtNum(prof.current.lower)} to ${fmtNum(prof.current.upper)})`
                  : p.busy ? "evaluating…" : "…"}
              </div>
              <DesirabilityControls p={p} />
              <div style={{ marginTop: 8 }}>
                {view === "prediction" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {prof?.factors.map((t) => (
                      <FactorTrace key={t.name} trace={t} yLo={yLo} yHi={yHi} value={p.settings[t.name] ?? null}
                        currentPredicted={prof.current.predicted} onChange={(v) => p.setSetting(t.name, v)} />
                    ))}
                  </div>
                ) : (
                  <ContourProfile model={p.model} factors={p.factors} settings={p.settings} onSet={p.setSetting} />
                )}
              </div>
              <ProfilerResultBook p={p} />
            </>
          )}
          {p.error && note(p.error, true)}
        </>
      )}
    </ToolWindow>
  );
}

export default ProfilerPanel;
