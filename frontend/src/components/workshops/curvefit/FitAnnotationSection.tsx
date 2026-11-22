// Curve Fit — "Result on graph" section (lazy chunk). Opt-in: nothing is drawn
// until "Add to graph". The annotation is an ordinary text annotation (move,
// restyle, edit, delete like any other) that follows re-fits while this panel
// is open; useFitAnnotation.ts holds the rules.

import type { FitResultInput } from "../../../lib/fitResultView";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { FitAnnotationFormat } from "../../../lib/fitAnnotationOptions";
import { useFitAnnotation } from "./useFitAnnotation";

interface Props {
  fitId: string;
  input: FitResultInput;
  /** The fit's inputs changed after it ran: the annotation is marked out of date. */
  stale: boolean;
}

const DIGITS = [0, 2, 3, 4, 5, 6];

export default function FitAnnotationSection({ fitId, input, stale }: Props) {
  const a = useFitAnnotation(fitId, input, stale);
  const { opts, setOpts } = a;
  return (
    <details style={{ marginTop: 10 }}>
      <summary className="qzk-field-lbl">Result on graph</summary>
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Select
            aria-label="Annotation format"
            options={[{ value: "plain", label: "Plain text" }, { value: "latex", label: "LaTeX equation" }]}
            value={opts.format}
            onChange={(e) => setOpts({ format: e.target.value as FitAnnotationFormat })}
          />
          <Select
            aria-label="Annotation digits"
            options={DIGITS.map((d) => ({ value: String(d), label: d === 0 ? "Digits: auto (±)" : `${d} sig. figs` }))}
            value={String(opts.digits)}
            onChange={(e) => setOpts({ digits: Number(e.target.value) })}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Checkbox checked={opts.equation} onChange={(equation) => setOpts({ equation })}>Include equation</Checkbox>
          <Checkbox checked={opts.r2} onChange={(r2) => setOpts({ r2 })}>Include R²</Checkbox>
          <Checkbox checked={opts.n} onChange={(n) => setOpts({ n })}>Include N</Checkbox>
          <Checkbox checked={opts.units} onChange={(units) => setOpts({ units })}>Include units</Checkbox>
        </div>
        {a.note && <div className="qzk-ds-meta" role="status" style={{ color: "var(--warn)" }}>{a.note}</div>}
        {a.onGraph && stale && (
          <div className="qzk-ds-meta" role="status" style={{ color: "var(--warn)" }}>
            Out of date: the graph text is marked until you press Fit again.
          </div>
        )}
        {a.edited && (
          <div className="qzk-ds-meta" role="status" style={{ color: "var(--warn)" }}>
            You edited this text, so re-fits and option changes leave it alone.
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {!a.onGraph && (
            <Button
              size="sm"
              disabled={stale}
              title={stale ? "Out of date: press Fit to refit the current data and settings first" : "Add the fit result to the graph as a text annotation (one line; Undo removes)"}
              onClick={a.add}
            >
              Add to graph
            </Button>
          )}
          {a.onGraph && a.edited && !stale && <Button size="sm" onClick={a.replaceEdit}>Replace my edit</Button>}
          {a.onGraph && <Button size="sm" variant="ghost" onClick={a.remove}>Remove from graph</Button>}
        </div>
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          One line, page-anchored top left. Drag, resize or edit it like any annotation; it follows re-fits while this panel is open.
        </div>
      </div>
    </details>
  );
}
