// Math extras workshop: the option fields of the four solver jobs (a root in a
// bracket, a minimum over a box, a system of equations, a minimisation under
// constraints). Same expression language as the custom fit.

import { Select } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import type { MathExtrasState } from "./useMathExtras";

const gap = { marginTop: 8 } as const;
const faint = { ...gap, color: "var(--text-faint)" } as const;
const mono = { width: "100%", fontFamily: "var(--font-mono)" } as const;

function Lines({ label, value, rows, placeholder, onChange }: { label: string; value: string; rows: number; placeholder: string; onChange: (v: string) => void }) {
  return (
    <>
      <label className="qzk-field-lbl" style={gap}>{label}</label>
      <textarea className="qzk-input" aria-label={label} rows={rows} placeholder={placeholder} style={mono} value={value} onChange={(e) => onChange(e.target.value)} />
    </>
  );
}

function Constants({ m }: { m: MathExtrasState }) {
  return (
    <>
      <label className="qzk-field-lbl" style={gap}>Fixed names (a = 2, b = 3)</label>
      <input className="qzk-input" aria-label="Constants" style={mono} value={m.form.constants} onChange={(e) => m.setForm({ constants: e.target.value })} />
    </>
  );
}

function RootBoxFields({ m }: { m: MathExtrasState }) {
  const f = m.form;
  const root = m.mode === "root";
  return (
    <>
      <label className="qzk-field-lbl">{root ? "f(x) =" : "Expression"}</label>
      <input className="qzk-input" aria-label="Expression" style={mono} placeholder={root ? "x^2 - a" : "(x - 1)^2 + (a + 2)^2"} value={f.expr} onChange={(e) => m.setForm({ expr: e.target.value })} />
      {root ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, ...gap }}>
            <NumberField aria-label="Bracket low" placeholder="From x" value={f.lo} onChange={(v) => m.setForm({ lo: v })} />
            <NumberField aria-label="Bracket high" placeholder="To x" value={f.hi} onChange={(v) => m.setForm({ hi: v })} />
            <NumberField aria-label="Target" placeholder="= value" value={f.target} onChange={(v) => m.setForm({ target: v })} />
          </div>
          <label className="qzk-field-lbl" style={gap}>Other names (a = 2, b = 3)</label>
          <input className="qzk-input" aria-label="Constants" style={mono} value={f.constants} onChange={(e) => m.setForm({ constants: e.target.value })} />
        </>
      ) : (
        <>
          <Select aria-label="Sense" options={[{ value: "min", label: "Minimise" }, { value: "max", label: "Maximise" }]} value={f.sense} onChange={(e) => m.setForm({ sense: e.target.value as "min" | "max" })} />
          <label className="qzk-field-lbl" style={gap}>Bounds, one variable per line</label>
          <textarea className="qzk-input" aria-label="Bounds" rows={3} placeholder={"x = -5 .. 5\na = -5 .. 5"} style={mono} value={f.bounds} onChange={(e) => m.setForm({ bounds: e.target.value })} />
        </>
      )}
      <div className="qzk-helptext" style={faint}>
        {root
          ? "Same expression language as the custom fit: x is the unknown, any other name needs a value above. Every root in the bracket is listed; a jump across a pole is not a root."
          : "Every name in the expression, x included, is a variable and needs bounds. Several starting points are tried from a fixed seed, so a rerun gives the same answer."}
      </div>
    </>
  );
}

function SystemFields({ m }: { m: MathExtrasState }) {
  const f = m.form;
  return (
    <>
      <Lines label="Equations" value={f.equations} rows={3} placeholder={"x^2 + y^2 = 4\ny = exp(-x)"} onChange={(v) => m.setForm({ equations: v })} />
      <Lines label="Starting values" value={f.guess} rows={2} placeholder={"x = 1\ny = 0.5"} onChange={(v) => m.setForm({ guess: v })} />
      <Constants m={m} />
      <div style={gap}>
        <Select aria-label="System method" options={[{ value: "hybr", label: "Powell hybrid" }, { value: "lm", label: "Levenberg-Marquardt" }]} value={f.sysMethod} onChange={(e) => m.setForm({ sysMethod: e.target.value as "hybr" | "lm" })} />
      </div>
      <div className="qzk-helptext" style={faint}>
        One equation per line, as lhs = rhs (or an expression meaning = 0). There must be as many equations as unknown names, and each unknown needs a starting value. It reports the residual norm and says when it did not converge. Another start can reach another solution.
      </div>
    </>
  );
}

function ConstrainedFields({ m }: { m: MathExtrasState }) {
  const f = m.form;
  return (
    <>
      <label className="qzk-field-lbl">Expression</label>
      <input className="qzk-input" aria-label="Expression" style={mono} placeholder="(x - 2)^2 + (y - 2)^2" value={f.expr} onChange={(e) => m.setForm({ expr: e.target.value })} />
      <div style={gap}>
        <Select aria-label="Sense" options={[{ value: "min", label: "Minimise" }, { value: "max", label: "Maximise" }]} value={f.sense} onChange={(e) => m.setForm({ sense: e.target.value as "min" | "max" })} />
      </div>
      <Lines label="Constraints" value={f.constraints} rows={3} placeholder={"x + y <= 2\nx^2 + y^2 = 4"} onChange={(v) => m.setForm({ constraints: v })} />
      <Lines label="Bounds (optional)" value={f.bounds} rows={2} placeholder="x = 0 .. 5" onChange={(v) => m.setForm({ bounds: v })} />
      <Lines label="Starting values" value={f.guess} rows={2} placeholder={"x = 0\ny = 0"} onChange={(v) => m.setForm({ guess: v })} />
      <Constants m={m} />
      <div style={gap}>
        <Select aria-label="Solver" options={[{ value: "SLSQP", label: "SLSQP" }, { value: "trust-constr", label: "Trust region (trust-constr)" }]} value={f.solver} onChange={(e) => m.setForm({ solver: e.target.value as "SLSQP" | "trust-constr" })} />
      </div>
      <div className="qzk-helptext" style={faint}>
        A constraint is lhs {"<="} rhs, lhs {">="} rhs or lhs = rhs. A name with bounds and no starting value starts mid-bounds. The result lists which constraints are active (binding) at the solution.
      </div>
    </>
  );
}

export function SolverFields({ m }: { m: MathExtrasState }) {
  if (m.mode === "system") return <SystemFields m={m} />;
  if (m.mode === "constrained") return <ConstrainedFields m={m} />;
  return <RootBoxFields m={m} />;
}
