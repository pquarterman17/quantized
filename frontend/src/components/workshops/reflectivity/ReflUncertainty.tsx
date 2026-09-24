// Reflectivity fit — "Estimate uncertainty (DREAM)" for one fit record (P2.2
// slice 4), shown under the live fit and under a saved one: the sampling
// settings, Run / Cancel with the job's progress, and — once the record has a
// posterior — its intervals beside the least-squares values, the R-hat
// verdict, the run's size, and the band actions. Thin: the state is
// useReflDream's, the summary the record's.

import { Button } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import PosteriorTable from "./PosteriorTable";
import type { ReflFitRecord } from "./reflFitRecord";
import { posteriorCaveat, type DreamSettings } from "./reflPosterior";
import type { ReflDreamState } from "./useReflDream";

const MONO = { fontFamily: "var(--font-mono)" } as const;
const FAINT = { color: "var(--text-faint)" } as const;

function Setting({ label, value, min, max, width = 64, disabled, onValue, optional }: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  width?: number;
  disabled: boolean;
  optional?: boolean;
  onValue: (v: number | null) => void;
}) {
  return (
    <label className="qzk-ds-meta" style={{ ...FAINT, display: "inline-flex", gap: 4, alignItems: "center" }}>
      {label}
      <BufferedNumberField
        aria-label={label}
        value={value ?? undefined}
        width={width}
        min={min}
        max={max}
        required={!optional}
        disabled={disabled}
        onValue={(v) => {
          if (v === undefined) {
            if (optional) onValue(null);
          } else if (Number.isInteger(v) && v >= min && v <= max) onValue(v);
        }}
      />
    </label>
  );
}

export default function ReflUncertainty({ dream, record }: { dream: ReflDreamState; record: ReflFitRecord }) {
  const s = dream.settings;
  const set = (k: keyof DreamSettings) => (v: number | null) => dream.setSettings({ [k]: v });
  const blocked = dream.blocked(record);
  const mine = dream.runningFor === record.id;
  const post = record.posterior;
  const caveat = post ? posteriorCaveat(post) : null;
  const c = post?.convergence;
  return (
    <section aria-label="uncertainty" style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
      <div className="qzk-field-lbl" style={{ marginBottom: 6 }}>Uncertainty (DREAM posterior)</div>
      {blocked ? (
        <div className="qzk-ds-meta qzk-msg" role="note" style={{ color: "var(--warn)" }}>
          {blocked}.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <Setting label="samples" value={s.samples} min={100} max={200_000} width={72} disabled={dream.busy} onValue={set("samples")} />
            <Setting label="burn-in" value={s.burn} min={0} max={5_000} disabled={dream.busy} onValue={set("burn")} />
            <Setting label="chains/param" value={s.pop} min={1} max={20} width={44} disabled={dream.busy} onValue={set("pop")} />
            <Setting label="seed" value={s.seed} min={0} max={4_294_967_295} disabled={dream.busy} optional onValue={set("seed")} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button size="sm" variant="primary" disabled={dream.busy} onClick={() => void dream.run(record)}>
              {mine ? "Sampling…" : post ? "Re-estimate uncertainty (DREAM)" : "Estimate uncertainty (DREAM)"}
            </Button>
            <Button size="sm" disabled={!mine} onClick={() => void dream.cancel()}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {mine && (
        <div style={{ marginTop: 8 }}>
          <div aria-label="DREAM progress" style={{ height: 4, borderRadius: 2, background: "var(--surface-2)", overflow: "hidden" }}>
            <div style={{ width: `${Math.round((dream.progress ?? 0) * 100)}%`, height: "100%", background: "var(--accent)" }} />
          </div>
          <div className="qzk-ds-meta" style={{ ...FAINT, ...MONO, marginTop: 4 }}>
            {Math.round((dream.progress ?? 0) * 100)}% — {dream.message || "sampling posterior"}
          </div>
        </div>
      )}

      {dream.error && !dream.busy && (
        <div className="qzk-ds-meta qzk-msg" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>
          {dream.error}
        </div>
      )}

      {post && c && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {caveat && (
            <div className="qzk-ds-meta qzk-msg" role="alert" style={{ color: "var(--warn)" }}>
              {caveat}
            </div>
          )}
          <PosteriorTable posterior={post} ls={record.result.parameters} />
          <div className="qzk-ds-meta" style={FAINT} data-testid="refl-dream-run">
            <span style={MONO}>{c.n_draws}</span> draws · <span style={MONO}>{c.n_chains}</span> chains · burn-in{" "}
            <span style={MONO}>{c.burn}</span> · thin <span style={MONO}>{c.thin}</span> · R-hat max{" "}
            <span style={MONO}>{c.rhat_max == null ? "—" : c.rhat_max.toFixed(3)}</span>
            {post.settings.seed != null && (
              <>
                {" "}
                · seed <span style={MONO}>{post.settings.seed}</span>
                {c.reproducible ? "" : " (not reproducible on this install)"}
              </>
            )}
          </div>
          {post.warnings.filter((w) => !w.startsWith("R-hat")).map((w) => (
            <div key={w} className="qzk-ds-meta qzk-msg" role="note" style={{ color: "var(--warn)" }}>
              {w}
            </div>
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button size="sm" disabled={!dream.hasBands(record) || dream.bandsAdded(record)} onClick={() => void dream.addBands(record)}>
              {dream.bandsAdded(record) ? "Uncertainty bands added" : "Add uncertainty bands"}
            </Button>
            <Button size="sm" disabled={!dream.hasBands(record)} onClick={() => dream.openBandPlot(record)}>
              Open band plot
            </Button>
          </div>
          {!dream.hasBands(record) && (
            <div className="qzk-ds-meta" style={FAINT}>
              The stored estimate keeps intervals and R-hat, not the bands: re-estimate to plot them.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
