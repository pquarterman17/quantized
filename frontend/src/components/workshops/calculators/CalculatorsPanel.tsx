// Calculators workshop — view. A draggable ToolWindow with two tools: a unit
// converter (value + from/to expressions, with quick-pick chips and a live
// result) and a CODATA physical-constants reference. Thin — all state/logic is
// in the hook; the math is golden in calc.unit_convert / calc.constants.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, DataTable, NumberField, Pill, SegmentedControl, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { useApp } from "../../../store/useApp";
import {
  QUICK_PAIRS,
  WAVELENGTHS,
  XRAY_MODES,
  useCalculators,
  type CalcTab,
} from "./useCalculators";

export default function CalculatorsPanel() {
  const setOpen = useApp((s) => s.setCalculatorsOpen);
  const c = useCalculators();

  return (
    <ToolWindow title="Calculators" width={340} onClose={() => setOpen(false)}>
      <SegmentedControl<CalcTab>
        options={[
          { value: "units", label: "Units" },
          { value: "xray", label: "X-ray" },
          { value: "constants", label: "Constants" },
        ]}
        value={c.tab}
        onChange={c.setTab}
      />

      {c.tab === "units" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <NumberField value={c.value} width={84} onChange={c.setValue} />
            <input
              className="qz-input"
              style={{ width: 64 }}
              value={c.from}
              onChange={(e) => c.setFrom(e.target.value)}
              aria-label="from unit"
            />
            <span style={{ color: "var(--text-faint)" }}>→</span>
            <input
              className="qz-input"
              style={{ width: 64 }}
              value={c.to}
              onChange={(e) => c.setTo(e.target.value)}
              aria-label="to unit"
            />
            <Button variant="primary" size="sm" disabled={c.busy} onClick={() => void c.convert()}>
              =
            </Button>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {QUICK_PAIRS.map((p) => (
              <Pill
                key={p.label}
                active={c.from === p.from && c.to === p.to}
                onClick={() => c.setPair(p.from, p.to)}
              >
                {p.label}
              </Pill>
            ))}
          </div>

          {c.result != null && !c.error && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
                {fmtNum(c.result)} <span style={{ color: "var(--text-dim)" }}>{c.to}</span>
              </div>
              {c.description && (
                <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
                  {c.description}
                </div>
              )}
            </div>
          )}
          {c.error && (
            <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--danger)" }}>
              {c.error}
            </div>
          )}
        </div>
      )}

      {c.tab === "xray" && (
        <div style={{ marginTop: 12 }}>
          <Select
            options={XRAY_MODES.map((m) => ({ value: m.value, label: m.label }))}
            value={c.xrayMode}
            onChange={(e) => c.setXrayMode(e.target.value)}
            aria-label="x-ray conversion"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <span className="qzk-field-lbl" style={{ margin: 0 }}>
              λ
            </span>
            <NumberField value={c.wavelength} width={84} onChange={c.setWavelength} />
            <span style={{ color: "var(--text-faint)" }}>Å</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {WAVELENGTHS.map((w) => (
              <Pill
                key={w.label}
                active={Number(c.wavelength) === w.a}
                onClick={() => c.setWavelength(String(w.a))}
              >
                {w.label}
              </Pill>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <NumberField value={c.xrayValue} width={100} onChange={c.setXrayValue} />
            <span style={{ color: "var(--text-faint)" }}>
              {XRAY_MODES.find((m) => m.value === c.xrayMode)?.inUnit ?? ""}
            </span>
            <Button variant="primary" size="sm" disabled={c.xrayBusy} onClick={() => void c.xrayCompute()}>
              =
            </Button>
          </div>
          {c.xrayResult && !c.xrayError && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
                {fmtNum(c.xrayResult.result)}{" "}
                <span style={{ color: "var(--text-dim)" }}>{c.xrayResult.unit}</span>
              </div>
              <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
                {c.xrayResult.description}
              </div>
            </div>
          )}
          {c.xrayError && (
            <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--danger)" }}>
              {c.xrayError}
            </div>
          )}
        </div>
      )}

      {c.tab === "constants" && (
        <div style={{ marginTop: 12 }}>
          {c.constants ? (
            <DataTable
              columns={["constant", "value (SI)"]}
              rows={Object.entries(c.constants).map(([k, v]) => [
                k,
                <span key={k} style={{ fontFamily: "var(--font-mono)" }}>
                  {fmtNum(v)}
                </span>,
              ])}
            />
          ) : (
            <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
              Constants unavailable (backend offline).
            </div>
          )}
        </div>
      )}
    </ToolWindow>
  );
}
