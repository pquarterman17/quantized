// Curve Fit — Global fit mode (lazy chunk). Fit one model to several series at
// once, with chosen parameters shared across all of them and the rest fitted
// per series (calc.global_curve_fit via useGlobalFit). CurveFitPanel mounts this
// in place of the single-fit body while "Global fit" is on.

import { Button, Select } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import GlobalFitResults from "./GlobalFitResults";
import { memberKey, type GlobalSource } from "./globalFitData";
import { useGlobalFit, type GlobalModel } from "./useGlobalFit";

const SOURCES = [
  { value: "channels", label: "Channels of this dataset" },
  { value: "datasets", label: "Datasets with these columns" },
];

export default function GlobalFitSection({ model }: { model: GlobalModel | null }) {
  const s = useGlobalFit(model);

  if (!model) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
        Pick a model to fit globally.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <label className="qzk-field-lbl">Fit across</label>
      <Select
        aria-label="Fit across"
        options={SOURCES}
        value={s.source}
        onChange={(e) => s.setSource(e.target.value as GlobalSource)}
      />
      <div role="group" aria-label="Series" style={{ maxHeight: 140, overflowY: "auto", marginTop: 6 }}>
        {s.candidates.map((m) => {
          const key = memberKey(m);
          return (
            <label key={key} className="qzk-ds-meta" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                aria-label={`Fit ${m.label}`}
                checked={s.picked.includes(key)}
                onChange={() => s.togglePick(key)}
              />
              {m.label}
            </label>
          );
        })}
      </div>
      {s.missing.length > 0 && (
        <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
          Without these columns: {s.missing.join(", ")}
        </div>
      )}

      <div className="qzk-ds-meta" style={{ display: "flex", gap: 6, marginTop: 8, color: "var(--text-faint)" }}>
        <span style={{ flex: 1 }}>parameter</span>
        <span style={{ width: 44 }}>shared</span>
        <span style={{ width: 64 }}>start</span>
        <span style={{ width: 64 }}>min</span>
        <span style={{ width: 64 }}>max</span>
      </div>
      {s.rows.map((row, i) => (
        <div key={row.name} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
          <span style={{ flex: 1 }} title={row.name}>
            {row.name}
          </span>
          <input
            type="checkbox"
            style={{ width: 44 }}
            checked={s.shared[i] ?? false}
            aria-label={`Share ${row.name} across all series`}
            title="Fit one value of this parameter for every series"
            onChange={(e) => s.setShared(i, e.target.checked)}
          />
          <NumberField
            value={row.start}
            width={64}
            placeholder="auto"
            title="Starting value for every series; leave unchanged to guess per series"
            onChange={(v) => s.setRow(i, { start: v })}
          />
          <NumberField value={row.min} width={64} placeholder="−∞" title="Lower bound; blank is unbounded" onChange={(v) => s.setRow(i, { min: v })} />
          <NumberField value={row.max} width={64} placeholder="∞" title="Upper bound; blank is unbounded" onChange={(v) => s.setRow(i, { max: v })} />
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <Button
          variant="primary"
          size="sm"
          disabled={s.busy}
          title="Fit the model to every picked series at once"
          onClick={() => void s.run()}
        >
          {s.busy ? "Fitting…" : "Fit globally"}
        </Button>
        {s.busy && (
          <Button size="sm" variant="ghost" onClick={() => void s.cancel()}>
            Cancel
          </Button>
        )}
        {s.busy && s.progress != null && (
          <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
            {s.progress}
          </span>
        )}
      </div>
      {s.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>
          {s.error}
        </div>
      )}
      <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
        Global fits run unweighted over each series' included rows.
      </div>
      <GlobalFitResults s={s} />
    </div>
  );
}
