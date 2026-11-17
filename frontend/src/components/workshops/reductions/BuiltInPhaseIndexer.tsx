// XRD reference pattern ▸ built-in phase (UX9-F). Pick a phase from the
// backend's phase database (verbatim MATLAB phaseDatabase port), set λ, and
// index measured peak positions: each peak's nearest allowed reflection within
// the tolerance, with d and Δ2θ (calc/xrd_index.py). "Label on plot" commits the
// phase's reflections as labelled reference sticks — the same RefLine groups the
// file importer writes (./referenceSticks), so the `{hkl}`/`{phase}` peak-label
// tokens (lib/peakPhaseMatch.ts) read them too.

import { useEffect, useMemo, useRef, useState } from "react";

import { xrdIndex, xrdPhases } from "../../../lib/api/reductions";
import { fmtNum } from "../../../lib/format";
import { includedPeaks, xChannelIdentity } from "../../../lib/peakTableFit";
import {
  absencesNote,
  CU_KA1_A,
  DEFAULT_INDEX_TOLERANCE,
  parsePeakList,
  type XrdIndexResult,
  type XrdPhaseChoice,
} from "../../../lib/xrdIndex";
import { wavelengthFromMetadata } from "../../../lib/xrdWavelength";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import { pawleyAxisProblem, scanRange } from "./pawleyInputs";
import { addReferenceSticks } from "./referenceSticks";

const hint = { marginTop: 8, color: "var(--text-faint)" } as const;
const grid = { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 10px", alignItems: "center", marginTop: 8 } as const;

/** Included fitted peak centres of the active dataset's durable table, as text. */
function fittedPeakText(ds: ReturnType<typeof useActiveDataset>): string {
  const t = ds?.peakTable;
  if (!t || t.provenance.datasetId !== ds.id) return "";
  return includedPeaks(t).map((p) => p.center.toFixed(4)).join(", ");
}

export default function BuiltInPhaseIndexer() {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const setStatus = useApp((s) => s.setStatus);
  const recordHistory = useApp((s) => s.recordHistory);
  const [phases, setPhases] = useState<XrdPhaseChoice[] | null>(null);
  const [phase, setPhase] = useState("Silicon");
  const metaWavelength = wavelengthFromMetadata(active?.data.metadata);
  const [wavelength, setWavelength] = useState(String(metaWavelength ?? CU_KA1_A));
  const [tolerance, setTolerance] = useState(String(DEFAULT_INDEX_TOLERANCE));
  const [peakText, setPeakText] = useState(() => fittedPeakText(active));
  const [result, setResult] = useState<XrdIndexResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef(0);

  useEffect(() => {
    let live = true;
    xrdPhases()
      .then((r) => { if (live) setPhases(r.phases); })
      .catch((e: unknown) => { if (live) setError(`Could not load the phase list — ${e instanceof Error ? e.message : "unknown error"}`); });
    return () => { live = false; };
  }, []);

  // A dataset switch re-seeds λ and the peak list from THAT dataset and drops
  // the previous dataset's result rather than showing it beside new data.
  const activeId = active?.id;
  useEffect(() => {
    setWavelength(String(wavelengthFromMetadata(active?.data.metadata) ?? CU_KA1_A));
    setPeakText(fittedPeakText(active));
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the dataset id only
  }, [activeId]);

  const lambda = Number(wavelength);
  const tol = Number(tolerance);
  const parsed = useMemo(() => parsePeakList(peakText), [peakText]);
  const finiteX = active?.data.time.filter(Number.isFinite) ?? [];
  const range = finiteX.length ? scanRange(finiteX) : null;
  const axisProblem = active
    ? xKey !== null
      ? "Use the dataset's 2θ time axis (not a worksheet column) to label the plot."
      : pawleyAxisProblem(xChannelIdentity(active.data, null), active.data.metadata, range)
    : "Select a powder XRD dataset to label the plot.";
  const inputProblem = !(lambda >= 0.2 && lambda <= 10)
    ? "Wavelength must be between 0.2 and 10 Å."
    : !(tol >= 0 && tol <= 5)
      ? "Tolerance must be between 0 and 5° 2θ."
      : "problem" in parsed ? parsed.problem : null;
  const twoThetaMin = range && !axisProblem ? Math.max(0, range.min) : 10;
  const twoThetaMax = range && !axisProblem ? Math.min(180, range.max) : 90;

  async function runIndex(): Promise<void> {
    if (inputProblem || "problem" in parsed) return;
    const mine = ++token.current;
    setBusy(true);
    setError(null);
    try {
      const r = await xrdIndex({
        phase, peaks: parsed.peaks, wavelength: lambda, tolerance: tol,
        two_theta_min: twoThetaMin, two_theta_max: Math.max(twoThetaMax, twoThetaMin + 1e-6),
      });
      if (mine === token.current) setResult(r);
    } catch (e) {
      if (mine === token.current) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Indexing failed.");
      }
    } finally {
      if (mine === token.current) setBusy(false);
    }
  }

  function labelOnPlot(): void {
    if (!result || axisProblem || result.reflections.length === 0) return;
    addReferenceSticks(
      `${result.phase.name} (built-in) · λ ${result.wavelength.toFixed(5)} Å`,
      // No intensity model: equal-height sticks mark positions only.
      result.reflections.map((r) => ({ twoTheta: r.two_theta, intensity: 1, label: r.label })),
      { baseline: 0.03, height: 0.18, color: "#d97706", showLabels: true },
      recordHistory,
      "label XRD phase reflections",
    );
    setStatus(`added ${result.reflections.length} ${result.phase.name} reflection${result.reflections.length === 1 ? "" : "s"}`);
  }

  const byCategory = useMemo(() => {
    const groups = new Map<string, XrdPhaseChoice[]>();
    for (const p of phases ?? []) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    return [...groups];
  }, [phases]);
  const note = result ? absencesNote(result.absences) : null;

  return (
    <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="qzk-helptext" style={hint}>
        Built-in phase: index peak positions against a phase-database cell, or label its reflections on the plot.
      </div>
      <div style={grid}>
        <label className="qzk-field-lbl" htmlFor="qz-xrd-phase">Phase</label>
        <select id="qz-xrd-phase" className="qz-select" value={phase} disabled={!phases}
          onChange={(e) => { setPhase(e.target.value); setResult(null); }}>
          {!phases && <option value={phase}>{phase}</option>}
          {byCategory.map(([category, list]) => (
            <optgroup key={category} label={category}>
              {list.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </optgroup>
          ))}
        </select>
        <label className="qzk-field-lbl">λ (Å)</label>
        <NumberField value={wavelength} onChange={setWavelength} width={90} aria-label="Indexing wavelength (Å)" />
        <label className="qzk-field-lbl">Tolerance (° 2θ)</label>
        <NumberField value={tolerance} onChange={setTolerance} width={90} step={0.01} aria-label="Indexing tolerance" />
        <label className="qzk-field-lbl" htmlFor="qz-xrd-peaks">Peaks (2θ)</label>
        <input id="qz-xrd-peaks" className="qz-input" value={peakText} placeholder="e.g. 28.44, 47.30"
          onChange={(e) => setPeakText(e.target.value)} />
      </div>
      <div className="qzk-ds-meta" style={hint}>
        {fittedPeakText(active) ? "Peaks default to this dataset's fitted peak centres." : "Fit peaks (Analyze ▸ Peaks) or type 2θ positions."}
        {metaWavelength == null ? " No wavelength in the file: Cu Kα1 assumed." : ""}
      </div>
      {inputProblem && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--danger)" }}>{inputProblem}</div>}
      {error && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--danger)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <Button size="sm" disabled={busy || !!inputProblem} onClick={() => void runIndex()}>
          {busy ? "Indexing…" : "Index peaks"}
        </Button>
        <Button size="sm" disabled={!result || !!axisProblem || result.reflections.length === 0} title={axisProblem ?? undefined} onClick={labelOnPlot}>
          Label on plot
        </Button>
      </div>
      {result && (
        <>
          <div className="qzk-ds-meta" style={hint} data-testid="xrd-index-summary">
            {result.phase.name}: {result.reflections.length} reflection{result.reflections.length === 1 ? "" : "s"} in {fmtNum(twoThetaMin)}–{fmtNum(twoThetaMax)}° · {result.n_matched} of {result.matches.length} peak{result.matches.length === 1 ? "" : "s"} indexed (±{fmtNum(result.tolerance)}°)
          </div>
          {note && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--warn)" }}>{note}</div>}
          {result.matches.length > 0 && (
            <div style={{ maxHeight: 220, overflow: "auto", marginTop: 8, border: "1px solid var(--border-subtle)" }}>
              <table className="qz-data-table" aria-label="peak indexing" style={{ width: "100%" }}>
                <thead><tr><th>Peak 2θ</th><th>hkl</th><th>d (Å)</th><th>Δ2θ</th></tr></thead>
                <tbody>
                  {result.matches.map((m, i) => (
                    <tr key={i}>
                      <td>{m.peak_two_theta == null ? "—" : m.peak_two_theta.toFixed(4)}</td>
                      <td>{m.label ?? "unindexed"}</td>
                      <td>{m.d_obs == null ? "—" : m.d_obs.toFixed(5)}</td>
                      <td>{m.delta == null ? "—" : `${m.delta >= 0 ? "+" : ""}${m.delta.toFixed(4)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
