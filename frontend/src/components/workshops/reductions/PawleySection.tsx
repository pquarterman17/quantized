import { Button, Select } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import { NumberField } from "../../primitives/NumberField";
import { fmtNum } from "../../../lib/format";
import { usePawley } from "./usePawley";

const CENTERING = [
  { value: "P", label: "Primitive (P)" },
  { value: "F", label: "Face-centered (F)" },
  { value: "I", label: "Body-centered (I)" },
  { value: "A", label: "A-centered" },
  { value: "B", label: "B-centered" },
  { value: "C", label: "C-centered" },
  { value: "R", label: "Rhombohedral (R)" },
];

export default function PawleySection() {
  const s = usePawley();
  if (!s.active) {
    return <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
      Select a powder XRD dataset (2θ vs intensity) first.
    </div>;
  }

  const grid = {
    display: "grid",
    gridTemplateColumns: "auto auto",
    gap: "6px 12px",
    marginTop: 10,
    alignItems: "center",
  } as const;

  return (
    <div style={{ marginTop: 10 }}>
      <label className="qzk-field-lbl">Intensity channel</label>
      <Select
        options={s.columns.map((x) => ({ value: String(x.index), label: x.label }))}
        value={String(s.col)}
        onChange={(e) => s.setCol(Number(e.target.value))}
      />

      <div style={grid}>
        <label className="qzk-field-lbl" style={{ margin: 0 }}>a (Å)</label>
        <NumberField value={s.a} width={88} step={0.001} onChange={(v) => s.setA(Number(v) || 0)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>b (Å)</label>
        <NumberField value={s.b} width={88} step={0.001} onChange={(v) => s.setB(Number(v) || 0)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>c (Å)</label>
        <NumberField value={s.c} width={88} step={0.001} onChange={(v) => s.setC(Number(v) || 0)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>Centering</label>
        <Select options={CENTERING} value={s.symmetry} onChange={(e) => s.setSymmetry(e.target.value)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>Wavelength (Å)</label>
        <NumberField value={s.wavelength} width={88} step={0.0001} onChange={(v) => s.setWavelength(Number(v) || 0)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>Profile FWHM (°)</label>
        <NumberField value={s.profileFwhm} width={88} step={0.01} onChange={(v) => s.setProfileFwhm(Number(v) || 0)} />
      </div>

      <label className="qzk-field-lbl" style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input type="checkbox" checked={s.refineCell} onChange={(e) => s.setRefineCell(e.target.checked)} />
        Refine unit cell
      </label>

      <Button variant="primary" size="sm" style={{ marginTop: 10 }} disabled={s.busy} onClick={() => void s.compute()}>
        {s.busy ? "Refining…" : "Refine"}
      </Button>

      {s.error && <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>{s.error}</div>}

      {s.result && (
        <div style={{ marginTop: 12 }}>
          <DataTable
            columns={["result", "value"]}
            rows={[
              ["a", `${fmtNum(s.result.cell[0])} Å`],
              ["b", `${fmtNum(s.result.cell[1])} Å`],
              ["c", `${fmtNum(s.result.cell[2])} Å`],
              ["Rwp", s.result.rwp == null ? "—" : fmtNum(s.result.rwp)],
              ["Reflections", String(s.result.n_peaks)],
            ]}
          />
          <Button size="sm" style={{ marginTop: 8 }} onClick={s.toLibrary}>→ Library</Button>
        </div>
      )}
    </div>
  );
}
