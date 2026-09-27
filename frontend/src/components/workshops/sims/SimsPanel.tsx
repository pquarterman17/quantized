// SIMS depth-profile workshop — view (audit P2.3). Pick a profile, turn on the
// stages you need (depth calibration, background, reference normalization,
// smoothing); the backend processes it LIVE and the panel shows the log-scale
// result and every warning before "Create" adds a new derived dataset. Thin —
// the logic lives in useSims, the params in simsForm.

import type { ReactNode } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import TransformWarningList from "../../overlays/TransformWarningList";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { SIMS_LENGTH_UNITS, SIMS_SMOOTH_METHODS, SIMS_TIME_UNITS, type SimsSmoothMethod } from "../../../lib/transformSims";
import { xExtent } from "../../../lib/plotDecimate";
import { useSimsDialog } from "../../../store/simsDialog";
import SimsPreviewPlot from "./SimsPreviewPlot";
import { useSims, type SimsState } from "./useSims";

const gap = { marginTop: 8 };
const row = { display: "flex", gap: 6, alignItems: "center", marginTop: 4 } as const;
const faint = { color: "var(--text-faint)" } as const;
const opts = (xs: readonly string[]) => xs.map((v) => ({ value: v, label: v }));
/** Length units: recorded as nm / A / um (the parser's spellings), shown as symbols. */
const LENGTH_LABEL: Record<string, string> = { nm: "nm", A: "Å", um: "µm" };
const lengthOpts = SIMS_LENGTH_UNITS.map((v) => ({ value: v, label: LENGTH_LABEL[v] ?? v }));
const fmt = (v: number): string => String(Number(v.toPrecision(5)));

function Calibration({ r }: { r: SimsState }) {
  const f = r.form;
  return (
    <div role="group" aria-label="Depth calibration">
      <div style={row}>
        <span className="qzk-ds-meta">x is time in</span>
        <Select
          aria-label="Time unit of x"
          options={[{ value: "", label: r.xUnit ? `${r.xUnit} (recorded)` : "— unknown —" }, ...opts(SIMS_TIME_UNITS)]}
          value={f.timeUnit}
          onChange={(e) => r.setForm({ timeUnit: e.target.value })}
        />
      </div>
      <Select
        aria-label="Calibration method"
        options={[
          { value: "crater", label: "Crater depth (profilometer)" },
          { value: "rate", label: "Known sputter rate" },
        ]}
        value={f.calMethod}
        onChange={(e) => r.setForm({ calMethod: e.target.value as "rate" | "crater" })}
        style={{ marginTop: 4 }}
      />
      {f.calMethod === "rate" ? (
        <div style={row}>
          <NumberField aria-label="Sputter rate" value={f.sputterRate} onChange={(v) => r.setForm({ sputterRate: v })} width={80} />
          <Select aria-label="Rate length unit" options={lengthOpts} value={f.rateLen} onChange={(e) => r.setForm({ rateLen: e.target.value })} />
          <span className="qzk-ds-meta">/</span>
          <Select aria-label="Rate time unit" options={opts(SIMS_TIME_UNITS)} value={f.rateTime} onChange={(e) => r.setForm({ rateTime: e.target.value })} />
        </div>
      ) : (
        <>
          <div style={row}>
            <NumberField aria-label="Crater depth" value={f.craterDepth} onChange={(v) => r.setForm({ craterDepth: v })} width={80} />
            <Select aria-label="Crater depth unit" options={lengthOpts} value={f.craterUnit} onChange={(e) => r.setForm({ craterUnit: e.target.value })} />
          </div>
          <div style={row}>
            <NumberField
              aria-label="Total sputter time"
              placeholder="last point"
              value={f.totalTime}
              onChange={(v) => r.setForm({ totalTime: v })}
              width={80}
              unit={f.timeUnit || r.xUnit || "x unit"}
            />
          </div>
        </>
      )}
      <div style={row}>
        <span className="qzk-ds-meta">depth in</span>
        <Select aria-label="Depth unit" options={lengthOpts} value={f.depthUnit} onChange={(e) => r.setForm({ depthUnit: e.target.value })} />
      </div>
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>
        Constant sputter rate; depth = rate × time from the start of sputtering.
      </div>
    </div>
  );
}

function Background({ r }: { r: SimsState }) {
  const unit = r.form.calOn ? r.form.depthUnit : r.xUnit;
  return (
    <div role="group" aria-label="Background region">
      <div style={row}>
        <NumberField aria-label="Background from" value={r.form.bgLo} onChange={(v) => r.setForm({ bgLo: v })} width={70} />
        <span className="qzk-ds-meta">to</span>
        <NumberField aria-label="Background to" value={r.form.bgHi} onChange={(v) => r.setForm({ bgHi: v })} width={70} unit={unit || undefined} />
      </div>
      <label className="qzk-field-lbl" style={{ marginTop: 6 }}>Leave unchanged</label>
      <div role="group" aria-label="Leave unchanged" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {r.labels.map((l) => (
          <Checkbox
            key={l}
            checked={r.form.bgKeep.includes(l)}
            onChange={(on) => r.setForm({ bgKeep: on ? [...r.form.bgKeep, l] : r.form.bgKeep.filter((k) => k !== l) })}
          >
            {l}
          </Checkbox>
        ))}
      </div>
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>
        Each other species' mean in this region is subtracted{r.form.calOn ? " (region in depth, after calibration)" : ""}.
        The normalization reference is always left alone.
      </div>
    </div>
  );
}

function Normalization({ r }: { r: SimsState }) {
  const f = r.form;
  return (
    <div role="group" aria-label="Reference normalization">
      <div style={row}>
        <span className="qzk-ds-meta">divide by</span>
        <Select
          aria-label="Reference species"
          options={r.labels.map((l) => ({ value: l, label: l }))}
          value={f.reference}
          onChange={(e) => r.setForm({ reference: e.target.value })}
        />
      </div>
      <label className="qzk-field-lbl" style={{ marginTop: 6 }}>RSF per species (blank = plain ratio)</label>
      <div style={{ display: "grid", gap: 2, maxHeight: 110, overflowY: "auto" }}>
        {r.labels.filter((l) => l !== f.reference).map((l) => (
          <div key={l} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="qzk-ds-meta" style={{ minWidth: 60 }}>{l}</span>
            <NumberField aria-label={`RSF for ${l}`} value={f.rsf[l] ?? ""} onChange={(v) => r.setRsf(l, v)} width={90} />
          </div>
        ))}
      </div>
      <div style={row}>
        <span className="qzk-ds-meta">RSF gives</span>
        <NumberField aria-label="RSF unit" numeric={false} value={f.rsfUnit} onChange={(v) => r.setForm({ rsfUnit: v })} width={100} />
      </div>
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>C = RSF × I / I<sub>ref</sub>, point by point.</div>
    </div>
  );
}

function Smoothing({ r }: { r: SimsState }) {
  const f = r.form;
  return (
    <div role="group" aria-label="Smoothing" style={row}>
      <Select
        aria-label="Smoothing method"
        options={SIMS_SMOOTH_METHODS.map((m) => ({ value: m, label: m }))}
        value={f.smoothMethod}
        onChange={(e) => r.setForm({ smoothMethod: e.target.value as SimsSmoothMethod })}
      />
      <NumberField aria-label="Half-width (points)" value={f.window} onChange={(v) => r.setForm({ window: v })} width={50} unit="pts" />
      {f.smoothMethod === "savitzky-golay" && (
        <NumberField aria-label="Polynomial order" value={f.polyOrder} onChange={(v) => r.setForm({ polyOrder: v })} width={40} />
      )}
    </div>
  );
}

function Preview({ r }: { r: SimsState }) {
  if (r.formError) return <div className="qzk-ds-meta" style={{ ...gap, ...faint }}>{r.formError}</div>;
  if (r.loading) return <div className="qzk-ds-meta" style={gap} aria-live="polite">Previewing…</div>;
  if (r.previewError) {
    return <div className="qzk-ds-meta" role="alert" style={{ ...gap, color: "var(--danger)" }}>{r.previewError}</div>;
  }
  const res = r.result;
  if (!res) return null;
  // One O(n) scan — never Math.min(...xs), which overflows the stack on a long profile.
  const range = xExtent(res.data.time);
  const unit = String(res.data.metadata?.x_column_unit ?? "");
  return (
    <div style={gap} aria-label="SIMS preview" role="group">
      <SimsPreviewPlot data={res.data} />
      {range && (
        <div className="qzk-ds-meta" style={{ marginTop: 4 }}>
          {String(res.data.metadata?.x_column_name ?? "x")}: {fmt(range[0])} … {fmt(range[1])} {unit}
        </div>
      )}
      {r.previewOnly && (
        <div className="qzk-ds-meta" style={{ marginTop: 4, ...faint }}>
          Previewed on the loaded rows; the full data is processed when you create.
        </div>
      )}
      <TransformWarningList warnings={r.warnings} />
    </div>
  );
}

function Stage({ label, on, set, children }: { label: string; on: boolean; set: (on: boolean) => void; children: ReactNode }) {
  return (
    <div style={gap}>
      <Checkbox checked={on} onChange={set}>{label}</Checkbox>
      {on && <div style={{ paddingLeft: 20 }}>{children}</div>}
    </div>
  );
}

/** Remounted on every opening, so running the command again re-seeds it. */
export default function SimsPanel() {
  const opened = useSimsDialog((s) => s.opened);
  return <SimsWorkshop key={opened} />;
}

function SimsWorkshop() {
  const r = useSims();
  const f = r.form;
  return (
    <ToolWindow id="sims" title="SIMS depth profile" width={360} onClose={r.close}>
      {!r.datasets.length ? (
        <div className="qzk-ds-meta" style={faint}>Load a SIMS profile to process.</div>
      ) : (
        <>
          <label className="qzk-field-lbl">Profile</label>
          <Select
            aria-label="Profile"
            options={r.datasets.map((d) => ({ value: d.id, label: d.name }))}
            value={r.datasetId}
            onChange={(e) => r.setDatasetId(e.target.value)}
          />
          <div className="qzk-ds-meta" style={{ marginTop: 4, ...faint }}>
            x: {r.xName}{r.xUnit ? ` (${r.xUnit})` : " (unit unknown)"} · {r.labels.length} species
          </div>
          <Stage label="Depth calibration (time → depth)" on={f.calOn} set={(on) => r.setForm({ calOn: on })}>
            <Calibration r={r} />
          </Stage>
          <Stage label="Subtract background" on={f.bgOn} set={(on) => r.setForm({ bgOn: on })}>
            <Background r={r} />
          </Stage>
          <Stage label="Normalize to a reference species" on={f.normOn} set={(on) => r.setForm({ normOn: on })}>
            <Normalization r={r} />
          </Stage>
          <Stage label="Smooth" on={f.smoothOn} set={(on) => r.setForm({ smoothOn: on })}>
            <Smoothing r={r} />
          </Stage>
          <Preview r={r} />
          <Button
            variant="primary"
            size="sm"
            disabled={!r.canCreate}
            onClick={() => void r.create()}
            style={{ marginTop: 12, width: "100%" }}
          >
            {r.busy ? "Creating…" : "Create processed dataset"}
          </Button>
          {r.error && (
            <div className="qzk-ds-meta" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>
              {r.error}
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
