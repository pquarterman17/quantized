// XRD reference pattern ▸ built-in phase ▸ search/match (lane xrd-overlays).
// Ranks every built-in phase (calc/xrd_search.py over the verbatim MATLAB
// phaseDatabase port) by how many of the indexer's peaks its reflections
// explain beyond chance, and hands a chosen candidate back to the indexer
// ("Index" = pick that phase and index the same peaks). Positions only: the
// built-in phases carry no intensities, so nothing here scores intensity.
//
// Fail closed: the search needs the scan's 2θ axis (its range is the span every
// phase is judged on) and a wavelength the file recorded or the user confirmed;
// an assumed Cu Kα1 is never searched on silently. Provisional, owner to confirm.

import { useRef, useState } from "react";

import { xrdSearch } from "../../../lib/api/reductions";
import { fmtNum } from "../../../lib/format";
import type { XrdSearchResult } from "../../../lib/xrdIndex";
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

export default function PhaseSearchPanel({ inputs, onUse }: {
  inputs: PhaseSearchInputs;
  onUse: (phase: string) => void;
}) {
  const { peaks, wavelength, wavelengthFromFile, tolerance, twoThetaMin, twoThetaMax } = inputs;
  // The confirmation is for ONE λ value: editing λ afterwards asks again.
  const [confirmedFor, setConfirmedFor] = useState<number | null>(null);
  const confirmed = confirmedFor === wavelength;
  const [result, setResult] = useState<XrdSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef(0);
  const stamp = useRunStamp(JSON.stringify([peaks, wavelength, tolerance, twoThetaMin, twoThetaMax]));
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
      const r = await xrdSearch({
        peaks, wavelength, tolerance, two_theta_min: twoThetaMin, two_theta_max: twoThetaMax,
      });
      if (mine === token.current) {
        stamp.record(launchKey);
        setResult(r);
      }
    } catch (e) {
      if (mine === token.current) {
        setResult(null);
        stamp.record(null);
        setError(e instanceof Error ? e.message : "Phase search failed.");
      }
    } finally {
      if (mine === token.current) setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }} data-testid="xrd-phase-search">
      <div className="qzk-helptext" style={hint}>
        Search: rank every built-in phase by how many of these peaks its reflections explain (positions only).
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
          {busy ? "Searching…" : "Search phases"}
        </Button>
      </div>
      {stale && <OutOfDateNote block>the peaks, wavelength, tolerance or scan range changed after this search. Search again.</OutOfDateNote>}
      {result && !stale && <SearchResults result={result} onUse={onUse} />}
    </div>
  );
}

function SearchResults({ result, onUse }: { result: XrdSearchResult; onUse: (phase: string) => void }) {
  return (
    <>
      <div className="qzk-ds-meta" style={hint} data-testid="xrd-search-summary">
        {result.candidates.length} candidate phase{result.candidates.length === 1 ? "" : "s"} for {result.n_peaks} peak{result.n_peaks === 1 ? "" : "s"} in {fmtNum(result.two_theta_min)}–{fmtNum(result.two_theta_max)}° (±{fmtNum(result.tolerance)}°, λ {result.wavelength.toFixed(5)} Å)
        {result.n_peaks_outside > 0 ? ` · ${result.n_peaks_outside} peak${result.n_peaks_outside === 1 ? "" : "s"} outside the scan not scored` : ""}
        {result.skipped.length > 0 ? ` · ${result.skipped.length} phase${result.skipped.length === 1 ? "" : "s"} not searched (${result.skipped.map((s) => s.name).join(", ")})` : ""}
      </div>
      {result.candidates.length > 0 && (
        <div style={{ maxHeight: 240, overflow: "auto", marginTop: 8, border: "1px solid var(--border-subtle)" }}>
          <table className="qz-data-table" aria-label="phase search" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Phase</th>
                <th title="Peaks within tolerance of one of the phase's reflections">Peaks</th>
                <th title="How many peaks the phase would match if they were placed at random">By chance</th>
                <th title="In-range reflections that have a peak (no intensities: weak lines may be missing)">Reflections</th>
                <th>Mean |Δ2θ|</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.candidates.map((c) => (
                <tr key={c.name}>
                  <td title={c.absences === "lattice" ? "Lattice absences only: some listed reflections may be absent" : c.formula}>
                    {c.name}{c.absences === "lattice" ? " †" : ""}
                  </td>
                  <td>{c.n_matched}/{result.n_peaks}</td>
                  <td>{c.expected_by_chance.toFixed(2)}</td>
                  <td>{c.reflections_observed}/{c.n_reflections}</td>
                  <td>{c.mean_abs_delta.toFixed(4)}</td>
                  <td><Button size="sm" aria-label={`Index with ${c.name}`} onClick={() => onUse(c.name)}>Index</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.candidates.some((c) => c.absences === "lattice") && (
        <div className="qzk-ds-meta" style={hint}>† no atomic basis tabulated: only lattice-centering absences applied.</div>
      )}
      <div className="qzk-ds-meta" style={hint}>
        Ranked by peaks explained minus the number expected by chance (provisional). Near-duplicate peaks on one reflection each count. Built-in phases only; no external database.
      </div>
    </>
  );
}
