// RSM analysis workshop — view. A draggable ToolWindow for a 2D reciprocal-
// space-map dataset: find the brightest peaks (substrate/film), then compute
// strain + relaxation from their Q-space centres. Thin — logic lives in useRsm.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, NumberField } from "../../primitives";
import { useApp } from "../../../store/useApp";
import { strainPair, useRsm } from "./useRsm";

function fmt(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(digits)).toString();
}

const pct = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(3)} %`;

export default function RsmPanel() {
  const setOpen = useApp((s) => s.setRsmOpen);
  const { active, isRsm, nPeaks, peaks, strain, busy, error, setNPeaks, analyze, computeStrain, clear } =
    useRsm();

  const close = () => {
    clear();
    setOpen(false);
  };
  const canStrain = !!peaks && strainPair(peaks) != null;

  return (
    <ToolWindow id="rsm" title="RSM analysis" width={360} onClose={close}>
      {!active && <Hint>Select a dataset first.</Hint>}
      {active && !isRsm && (
        <Hint>
          The active dataset is not a 2-D reciprocal-space map. Import a 2-D XRDML
          area scan (it carries Qx/Qz columns).
        </Hint>
      )}

      {isRsm && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              Peaks
            </label>
            <NumberField value={nPeaks} width={64} onChange={(v) => setNPeaks(Math.max(1, Number(v) || 1))} />
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void analyze()}>
              {busy ? "Working…" : "Find peaks"}
            </Button>
          </div>

          {peaks && peaks.length > 0 && (
            <table className="qzk-rsm-table" style={{ width: "100%", marginTop: 12, fontSize: 11 }}>
              <thead style={{ color: "var(--text-faint)", textAlign: "right" }}>
                <tr>
                  <th style={{ textAlign: "left" }}>type</th>
                  <th>ω</th>
                  <th>2θ</th>
                  <th>Qx</th>
                  <th>Qz</th>
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                {peaks.map((p) => (
                  <tr key={p.rank} style={{ textAlign: "right" }}>
                    <td style={{ textAlign: "left", color: "var(--text)" }}>{p.classification}</td>
                    <td>{fmt(p.centre_angle[0], 5)}</td>
                    <td>{fmt(p.centre_angle[1], 5)}</td>
                    <td>{fmt(p.centre_Q[0])}</td>
                    <td>{fmt(p.centre_Q[1])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {peaks && peaks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Button size="sm" disabled={busy || !canStrain} onClick={() => void computeStrain()}>
                Compute strain →
              </Button>
            </div>
          )}

          {strain && (
            <div
              className="qzk-ds-meta"
              style={{ marginTop: 12, display: "grid", gridTemplateColumns: "auto auto", gap: "4px 16px" }}
            >
              <span>ε∥ (in-plane)</span>
              <strong>{pct(strain.eps_parallel)}</strong>
              <span>ε⊥ (out-of-plane)</span>
              <strong>{pct(strain.eps_perp)}</strong>
              <span>Relaxation R</span>
              <strong>{strain.relaxation == null ? "—" : fmt(strain.relaxation, 3)}</strong>
              <span>a∥ film / sub (Å)</span>
              <strong>
                {fmt(strain.a_film_parallel)} / {fmt(strain.a_sub_parallel)}
              </strong>
              <span>a⊥ film / sub (Å)</span>
              <strong>
                {fmt(strain.a_film_perp)} / {fmt(strain.a_sub_perp)}
              </strong>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {error}
        </div>
      )}
    </ToolWindow>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
      {children}
    </div>
  );
}
