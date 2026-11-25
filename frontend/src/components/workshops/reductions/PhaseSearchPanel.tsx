// XRD reference pattern ▸ built-in phase ▸ phase match (OPEN_ITEMS #20, on the
// lane xrd-overlays search hand-off). Ranks every built-in phase AND every
// reference stick pattern on the plot with the backend matcher
// (calc/phase_match.py): position matching within the tolerance, fraction of
// peaks explained, fraction of strong reference lines observed, plus an
// intensity term where both sides have intensities. The accepted phases come
// from residual matching (peaks the top phase explains are removed, then the
// rest are matched again). The FOM is this app's, provisional, owner to confirm.
// "Index" hands a built-in candidate to the indexer; "Show overlay" puts its
// reflections on the plot through the existing reference-stick path.
//
// Fail closed: the match needs the scan's 2θ axis and a wavelength the file
// recorded or the user confirmed; an assumed Cu Kα1 is never matched on silently.

import { useMemo, useRef, useState } from "react";

import { xrdMatch } from "../../../lib/api/reductions";
import { fmtNum } from "../../../lib/format";
import { patternsFromRefLines, type XrdMatchCandidate, type XrdMatchResult } from "../../../lib/xrdMatch";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { OutOfDateNote } from "../workbench/WorkbenchParts";
import { useRunStamp } from "../workbench/useRunStamp";

const hint = { marginTop: 8, color: "var(--text-faint)" } as const;

export interface PhaseSearchInputs {
  peaks: number[];
  wavelength: number;
  /** The wavelength came from the file's metadata (no confirmation needed). */
  wavelengthFromFile: boolean;
  tolerance: number;
  twoThetaMin: number;
  twoThetaMax: number;
  /** Why the inputs cannot be searched (bad λ/tolerance/peaks, wrong axis). */
  problem: string | null;
}

export default function PhaseSearchPanel({ inputs, onUse, onOverlay }: {
  inputs: PhaseSearchInputs;
  onUse: (phase: string) => void;
  onOverlay: (phase: string) => void;
}) {
  const { peaks, wavelength, wavelengthFromFile, tolerance, twoThetaMin, twoThetaMax } = inputs;
  // The confirmation is for ONE λ value: editing λ afterwards asks again.
  const [confirmedFor, setConfirmedFor] = useState<number | null>(null);
  const confirmed = confirmedFor === wavelength;
  const [result, setResult] = useState<XrdMatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef(0);
  const refLines = useApp((st) => st.refLines);
  const patterns = useMemo(() => patternsFromRefLines(refLines), [refLines]);
  const stamp = useRunStamp(JSON.stringify([peaks, wavelength, tolerance, twoThetaMin, twoThetaMax, patterns]));
  const stale = result !== null && stamp.stale;
  // inputs.problem is already shown by the section above (axis, λ, peak list):
  // it only disables the button here; this panel prints its own reasons.
  // A one-point scan has no span to judge phases on (the route refuses min ≥ max).
  const ownProblem = (!(twoThetaMax > twoThetaMin) ? "The scan covers no 2θ range to search." : null)
    ?? (peaks.length === 0 ? "Enter or fit at least one peak to search." : null)
    ?? (!wavelengthFromFile && !confirmed ? "The file records no wavelength: confirm λ before searching." : null);
  const problem = inputs.problem ?? ownProblem;

  async function run(): Promise<void> {
    if (problem) return;
    const mine = ++token.current;
    const launchKey = stamp.launchKey();
    setBusy(true);
    setError(null);
    try {
      const r = await xrdMatch({
        peaks, wavelength, tolerance, two_theta_min: twoThetaMin, two_theta_max: twoThetaMax, patterns,
      });
      if (mine === token.current) {
        stamp.record(launchKey);
        setResult(r);
      }
    } catch (e) {
      if (mine === token.current) {
        setResult(null);
        stamp.record(null);
        setError(e instanceof Error ? e.message : "Phase match failed.");
      }
    } finally {
      if (mine === token.current) setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }} data-testid="xrd-phase-search">
      <div className="qzk-helptext" style={hint}>
        Match: rank the built-in phases and the reference patterns on the plot against these peaks (positions; intensities where a pattern has them).
      </div>
      {!wavelengthFromFile && (
        <Checkbox checked={confirmed} onChange={(on) => setConfirmedFor(on ? wavelength : null)}>
          λ = {fmtNum(wavelength)} Å is right for this scan (not recorded in the file)
        </Checkbox>
      )}
      {!inputs.problem && ownProblem && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--warn)" }}>{ownProblem}</div>}
      {error && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--danger)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <Button size="sm" disabled={busy || !!problem} title={problem ?? undefined} onClick={() => void run()}>
          {busy ? "Matching…" : "Match phases"}
        </Button>
      </div>
      {stale && <OutOfDateNote block>the peaks, wavelength, tolerance or scan range changed after this search. Search again.</OutOfDateNote>}
      {result && !stale && <MatchResults result={result} onUse={onUse} onOverlay={onOverlay} />}
    </div>
  );
}

const ppos = (n: number) => n.toFixed(2);

function MatchResults({ result, onUse, onOverlay }: {
  result: XrdMatchResult;
  onUse: (phase: string) => void;
  onOverlay: (phase: string) => void;
}) {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return (
    <>
      <div className="qzk-ds-meta" style={hint} data-testid="xrd-search-summary">
        {plural(result.n_candidates, "candidate phase")} for {plural(result.n_peaks, "peak")} in {fmtNum(result.two_theta_min)}–{fmtNum(result.two_theta_max)}° (±{fmtNum(result.tolerance)}°, λ {result.wavelength.toFixed(5)} Å)
        {result.n_peaks_outside > 0 ? ` · ${plural(result.n_peaks_outside, "peak")} outside the scan not scored` : ""}
        {result.skipped.length > 0 ? ` · ${plural(result.skipped.length, "phase")} not searched (${result.skipped.map((s) => s.name).join(", ")})` : ""}
      </div>
      <div className="qzk-ds-meta" style={hint} data-testid="xrd-match-accepted">
        {result.phases.length === 0
          ? `No phase reaches FOM ${ppos(result.min_fom)}: the peaks are unexplained.`
          : result.phases.map((p) => `${p.step}. ${p.name} (FOM ${ppos(p.fom)}): ${p.matches.map((m) => `${m.two_theta.toFixed(3)}${m.label ? ` ${m.label}` : ""}`).join(", ")}`).join(" | ")}
      </div>
      <div className="qzk-ds-meta" style={hint} data-testid="xrd-match-unexplained">
        {result.unexplained.length === 0 ? "Every peak is explained." : `Unexplained: ${result.unexplained.map((u) => u.two_theta.toFixed(3)).join(", ")}`}
      </div>
      {result.ranked.length > 0 && (
        <div style={{ maxHeight: 240, overflow: "auto", marginTop: 8, border: "1px solid var(--border-subtle)" }}>
          <table className="qz-data-table" aria-label="phase match" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Phase</th>
                <th title="This app's figure of merit (provisional): peaks explained x strong lines seen x agreement">FOM</th>
                <th title="Peaks matched one-to-one within tolerance">Peaks</th>
                <th title="Strong reference lines with a peak (no intensities: every line counts)">Strong lines</th>
                <th>Mean |Δ2θ|</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.ranked.map((c) => <CandidateRow key={`${c.source}:${c.name}`} c={c} result={result} onUse={onUse} onOverlay={onOverlay} />)}
            </tbody>
          </table>
        </div>
      )}
      {result.ranked.some((c) => c.source === "builtin" && c.absences === "lattice") && (
        <div className="qzk-ds-meta" style={hint}>† no atomic basis tabulated: only lattice-centering absences applied.</div>
      )}
      <div className="qzk-ds-meta" style={hint}>
        FOM = peaks explained × strong lines observed × mean of position (and intensity) agreement (provisional, owner to confirm). Built-in phases carry no intensities; a pattern without λ is assumed to share the scan's.
      </div>
    </>
  );
}

function CandidateRow({ c, result, onUse, onOverlay }: {
  c: XrdMatchCandidate;
  result: XrdMatchResult;
  onUse: (phase: string) => void;
  onOverlay: (phase: string) => void;
}) {
  const builtin = c.source === "builtin";
  return (
    <tr>
      <td title={builtin && c.absences === "lattice" ? "Lattice absences only: some listed reflections may be absent" : c.wavelength_assumed ? "Pattern wavelength not stated: assumed equal to the scan's" : c.formula}>
        {c.name}{builtin && c.absences === "lattice" ? " †" : ""}{c.source === "pattern" ? " (on plot)" : ""}
      </td>
      <td title={`peaks ${ppos(c.f_obs)} · lines ${ppos(c.f_ref)} · position ${ppos(c.position_term)}${c.intensity_term == null ? "" : ` · intensity ${ppos(c.intensity_term)}`}`}>{ppos(c.fom)}</td>
      <td>{c.n_matched}/{result.n_peaks}</td>
      <td>{c.n_strong_observed}/{c.n_strong_lines}</td>
      <td>{c.mean_abs_delta.toFixed(4)}</td>
      <td>
        {builtin && (
          <>
            <Button size="sm" aria-label={`Index with ${c.name}`} onClick={() => onUse(c.name)}>Index</Button>{" "}
            <Button size="sm" aria-label={`Show overlay of ${c.name}`} onClick={() => onOverlay(c.name)}>Show overlay</Button>
          </>
        )}
      </td>
    </tr>
  );
}
