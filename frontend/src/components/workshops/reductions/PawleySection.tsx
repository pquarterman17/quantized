import { Button, Select } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import { NumberField } from "../../primitives/NumberField";
import type { PawleyField, PawleyTie } from "./pawleyInputs";
import { pawleyVerdict } from "./pawleyInputs";
import { type PawleyCentering, usePawley } from "./usePawley";

const CENTERING: { value: PawleyCentering; label: string }[] = [
  { value: "P", label: "Primitive (P)" },
  { value: "F", label: "Face-centered (F)" },
  { value: "I", label: "Body-centered (I)" },
  { value: "A", label: "A-centered" },
  { value: "B", label: "B-centered" },
  { value: "C", label: "C-centered" },
  // The engine applies the obverse rule on HEXAGONAL axes; a rhombohedral-
  // axes cell (a = b = c, α = β = γ ≠ 90°) must be entered as primitive.
  { value: "R", label: "R (hexagonal axes)" },
];

const TIES: { value: PawleyTie; label: string }[] = [
  { value: "abc", label: "Cubic (a = b = c)" },
  { value: "ab", label: "Tetragonal / hexagonal (a = b)" },
  { value: "none", label: "Independent a, b, c" },
];

const hint = { marginTop: 10, color: "var(--text-faint)" } as const;
const lbl = { margin: 0 } as const;

const fixed4 = (v: number): string => v.toFixed(4);
const pct = (v: number | null): string => (v == null ? "—" : `${(100 * v).toFixed(2)} %`);

export default function PawleySection() {
  const s = usePawley();
  if (!s.active) {
    return <div className="qzk-ds-meta" style={hint}>Select a powder XRD dataset (2θ vs intensity) first.</div>;
  }

  const grid = {
    display: "grid",
    gridTemplateColumns: "auto auto",
    gap: "6px 12px",
    marginTop: 10,
    alignItems: "center",
  } as const;

  const field = (k: PawleyField, label: string, step: number, disabled = false) => (
    <>
      <label className="qzk-field-lbl" style={lbl}>{label}</label>
      <NumberField
        value={disabled ? s.fields.a : s.fields[k]}
        width={88}
        step={step}
        disabled={disabled}
        aria-label={label}
        onChange={(v) => s.setField(k, v)}
      />
    </>
  );

  const r = s.result;
  const verdict = r ? pawleyVerdict(r, s.fitRefined) : null;
  const range = s.fitRange;

  return (
    <div style={{ marginTop: 10 }}>
      <label className="qzk-field-lbl">Intensity channel</label>
      <Select
        options={s.columns.map((x) => ({ value: String(x.index), label: x.label }))}
        value={String(s.col)}
        onChange={(e) => s.setCol(Number(e.target.value))}
      />

      <div style={grid}>
        <label className="qzk-field-lbl" style={lbl}>Axes</label>
        <Select options={TIES} value={s.tie} onChange={(e) => s.setTie(e.target.value as PawleyTie)} />
        {field("a", "a (Å)", 0.001)}
        {field("b", "b (Å)", 0.001, s.tie !== "none")}
        {field("c", "c (Å)", 0.001, s.tie === "abc")}
        {field("alpha", "α (°)", 0.1)}
        {field("beta", "β (°)", 0.1)}
        {field("gamma", "γ (°)", 0.1)}
        <label className="qzk-field-lbl" style={lbl}>Centering</label>
        <Select
          options={CENTERING}
          value={s.symmetry}
          onChange={(e) => s.setSymmetry(e.target.value as PawleyCentering)}
        />
        {field("wavelength", s.wavelengthFromFile ? "Wavelength (Å, from file)" : "Wavelength (Å)", 0.0001)}
        {field("fwhm", "Profile FWHM (°)", 0.01)}
      </div>

      <label className="qzk-field-lbl" style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input type="checkbox" checked={s.refineCell} onChange={(e) => s.setRefineCell(e.target.checked)} />
        Refine unit cell
      </label>
      <div className="qzk-ds-meta" style={hint}>
        Local refinement: start close to the true cell. Angles are held fixed.
      </div>

      <Button
        variant="primary"
        size="sm"
        style={{ marginTop: 10 }}
        disabled={s.busy || !s.canCompute}
        onClick={() => void s.compute()}
      >
        {s.busy ? "Refining…" : "Refine"}
      </Button>

      {/* A disabled button always says why. */}
      {!s.canCompute && s.blockedReason && <div className="qzk-ds-meta" style={hint}>{s.blockedReason}</div>}

      {s.error && <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>{s.error}</div>}

      {r && (
        <div style={{ marginTop: 12 }}>
          {verdict && (
            <div className="qzk-ds-meta" role="alert" style={{ marginBottom: 8, color: "var(--danger)" }}>
              {verdict}
            </div>
          )}
          <DataTable
            columns={["result", "value"]}
            rows={[
              ["a", `${fixed4(r.cell[0])} Å`],
              ["b", `${fixed4(r.cell[1])} Å`],
              ["c", `${fixed4(r.cell[2])} Å`],
              ["α, β, γ (fixed)", `${r.cell[3]}°, ${r.cell[4]}°, ${r.cell[5]}°`],
              ["Rwp", pct(r.rwp)],
              ["Rwp (start)", pct(r.rwp_initial)],
              [
                "Reflections",
                range ? `${r.n_peaks} in ${range.min.toFixed(1)}–${range.max.toFixed(1)}°` : String(r.n_peaks),
              ],
            ]}
          />
          <Button size="sm" style={{ marginTop: 8 }} onClick={s.toLibrary}>→ Library</Button>
        </div>
      )}
    </div>
  );
}
