// Reflectivity fit — data binding view. Which dataset(s) and columns are the
// measured curve(s), whether x is Q or 2θ (with λ), the Q window, weighting and
// resolution. Stateless: every edit routes back through useReflFit.

import { Button, Select } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Checkbox } from "../../primitives/Checkbox";
import { IconButton } from "../../primitives/IconButton";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { formatNum } from "./reflFitModel";
import { MAX_CHANNELS, type ChannelBinding, type Spin, type XKind } from "./reflFitData";
import type { ReflFitState } from "./useReflFit";

const LBL = { margin: 0 } as const;
// Field labels are uppercased by CSS; a label that IS a symbol (dR, dQ/Q, λ, σ)
// must keep its case — "DQ/Q (1Σ)" and "Λ" say something else.
const SYM = { margin: 0, textTransform: "none" } as const;
const NONE = "__none__";

function columnOptions(labels: string[], allowNone: boolean): { value: string; label: string }[] {
  const cols = labels.map((l, i) => ({ value: String(i), label: l || `col ${i + 1}` }));
  return allowNone ? [{ value: NONE, label: "— none" }, ...cols] : cols;
}

const colValue = (c: number | null): string => (c == null ? NONE : String(c));
const colFrom = (v: string): number | null => (v === NONE ? null : Number(v));

function ChannelRow({
  fit,
  ch,
  index,
}: {
  fit: ReflFitState;
  ch: ChannelBinding;
  index: number;
}) {
  const labels = fit.datasets.find((d) => d.id === ch.datasetId)?.data.labels ?? [];
  const dsOptions = fit.datasets.map((d) => ({ value: d.id, label: d.name }));
  const n = index + 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span className="qzk-ds-meta" style={{ width: 22, fontFamily: "var(--font-mono)" }}>#{n}</span>
        <Select
          aria-label={`channel ${n} dataset`}
          options={dsOptions}
          value={ch.datasetId}
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) =>
            index === 0 && fit.channels.length === 1
              ? fit.selectDataset(e.target.value)
              : fit.setChannel(index, { datasetId: e.target.value })
          }
        />
        <Select
          aria-label={`channel ${n} spin`}
          options={[
            { value: "none", label: "unpolarised" },
            { value: "+", label: "spin +" },
            { value: "-", label: "spin −" },
          ]}
          value={ch.spin}
          onChange={(e) => fit.setChannel(index, { spin: e.target.value as Spin })}
        />
        <IconButton title={`Remove channel ${n}`} disabled={fit.channels.length <= 1} onClick={() => fit.removeChannel(index)}>
          ✕
        </IconButton>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "4px 6px", alignItems: "center" }}>
        <label className="qzk-field-lbl" style={SYM}>R</label>
        <Select
          aria-label={`channel ${n} R column`}
          options={columnOptions(labels, false)}
          value={String(ch.rCol)}
          onChange={(e) => fit.setChannel(index, { rCol: Number(e.target.value) })}
        />
        <label className="qzk-field-lbl" style={SYM}>dR</label>
        <Select
          aria-label={`channel ${n} dR column`}
          options={columnOptions(labels, true)}
          value={colValue(ch.drCol)}
          onChange={(e) => fit.setChannel(index, { drCol: colFrom(e.target.value) })}
        />
        <label className="qzk-field-lbl" style={SYM}>dQ</label>
        <Select
          aria-label={`channel ${n} dQ column`}
          options={columnOptions(labels, true)}
          value={colValue(ch.dqCol)}
          onChange={(e) => fit.setChannel(index, { dqCol: colFrom(e.target.value) })}
        />
        <span />
        <Checkbox
          checked={ch.dqIsFwhm}
          disabled={ch.dqCol == null}
          onChange={(v) => fit.setChannel(index, { dqIsFwhm: v })}
          title="The dQ column is a full width at half maximum (converted to 1σ)"
        >
          dQ is FWHM
        </Checkbox>
      </div>
    </div>
  );
}

export default function FitDataBinding({ fit }: { fit: ReflFitState }) {
  const { settings } = fit;
  if (fit.datasets.length === 0) {
    return (
      <div className="qzk-ds-meta qzk-msg" role="note">
        Import a reflectivity dataset (e.g. an NCNR .refl or .pnr) to fit the model to it.
      </div>
    );
  }
  const allDr = fit.channels.every((c) => c.drCol != null);
  const allDq = fit.channels.length > 0 && fit.channels.every((c) => c.dqCol != null);
  const lambdaMissing = settings.xKind === "twotheta" && fit.lambda == null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {fit.channels.length === 0 ? (
        <Select
          aria-label="dataset to fit"
          options={[{ value: "", label: "Choose a dataset…" }, ...fit.datasets.map((d) => ({ value: d.id, label: d.name }))]}
          value=""
          onChange={(e) => e.target.value && fit.selectDataset(e.target.value)}
        />
      ) : (
        fit.channels.map((ch, i) => <ChannelRow key={i} fit={fit} ch={ch} index={i} />)
      )}
      {fit.channels.length > 0 && (
        <div>
          <Button size="sm" variant="ghost" disabled={fit.channels.length >= MAX_CHANNELS} onClick={fit.addChannel}>
            + Add channel
          </Button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", alignItems: "center" }}>
        <label className="qzk-field-lbl" style={LBL}>x axis</label>
        <SegmentedControl<XKind>
          options={[
            { value: "q", label: "Q (Å⁻¹)" },
            { value: "twotheta", label: "2θ (deg)" },
          ]}
          value={settings.xKind}
          onChange={(v) => fit.setSettings({ xKind: v })}
        />
        {settings.xKind === "twotheta" && (
          <>
            <label className="qzk-field-lbl" style={SYM}>λ (Å)</label>
            <BufferedNumberField
              aria-label="wavelength override"
              value={settings.lambda ?? undefined}
              placeholder={fit.lambda != null ? formatNum(fit.lambda) : "unknown"}
              min={0}
              width={80}
              onValue={(v) => fit.setSettings({ lambda: v != null && v > 0 ? v : null })}
            />
          </>
        )}
        <label className="qzk-field-lbl" style={LBL}>Q window</label>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <BufferedNumberField
            aria-label="Q min"
            value={settings.qMin ?? undefined}
            placeholder="min"
            width={70}
            onValue={(v) => fit.setSettings({ qMin: v ?? null })}
          />
          <span style={{ color: "var(--text-faint)" }}>–</span>
          <BufferedNumberField
            aria-label="Q max"
            value={settings.qMax ?? undefined}
            placeholder="max"
            width={70}
            onValue={(v) => fit.setSettings({ qMax: v ?? null })}
          />
        </span>
        <label className="qzk-field-lbl" style={LBL}>Weighting</label>
        <select
          aria-label="weighting"
          className="qz-select"
          value={fit.weighting}
          onChange={(e) => fit.setSettings({ weighting: e.target.value as "dr" | "log" })}
        >
          <option value="dr" disabled={!allDr}>
            1/dR (χ²){allDr ? "" : " — needs a dR column"}
          </option>
          <option value="log">log₁₀ R (equal scatter)</option>
        </select>
        <label className="qzk-field-lbl" style={SYM}>dQ/Q (1σ)</label>
        <BufferedNumberField
          aria-label="resolution dQ/Q"
          value={settings.resolution}
          min={0}
          max={0.5}
          width={70}
          disabled={allDq}
          title={allDq ? "every channel uses its dQ column" : "constant resolution for channels without a dQ column; 0 = off"}
          onValue={(v) => fit.setSettings({ resolution: v ?? 0 })}
        />
      </div>
      {lambdaMissing && (
        <div className="qzk-ds-meta qzk-msg" role="alert" style={{ color: "var(--danger)" }}>
          The X-ray wavelength is unknown for this dataset — enter λ to convert 2θ to Q.
        </div>
      )}
    </div>
  );
}
