// Magnetometry tools workshop — view. A draggable ToolWindow with two transforms:
// "Background" removes a linear background — the one-sided high-T fit for M(T),
// the two-tail susceptibility removal + re-centring for an M(H) loop, chosen by
// what the x axis declares itself to be (BUG-021); "Units" converts the field
// unit and normalizes the moment on an explicit basis (NormalizationPane,
// MAIN_PLAN #42). Each writes a new dataset to the library.
// Thin — all state/logic lives in the hook; the math is golden in calc.magnetometry.

import ToolWindow from "../../overlays/ToolWindow";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Button, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { useApp } from "../../../store/useApp";
import {
  DEFAULT_AUTO_FRACTION,
  DEFAULT_HI_FRACTION,
  useMagTools,
  type MagBgMode,
  type MagTab,
} from "./useMagTools";
import DemagCorrectionPane from "./DemagCorrectionPane";
import CurieWeissPane from "./CurieWeissPane";
import NormalizationPane from "./NormalizationPane";

const BG_MODE_OPTS: { value: MagBgMode; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "mt", label: "M(T) — high-T tail" },
  { value: "mh", label: "M(H) — hysteresis loop" },
];

/** What the selected path actually does, in one sentence. The M(T) wording is
 *  only true of the M(T) path — saying it over a loop is how the wrong
 *  analysis went unnoticed. */
function bgDescription(path: "mt" | "mh" | null, reason: string): string {
  if (path === "mt") return "Fits a line to the high-T tail of M(T) and subtracts it.";
  if (path === "mh")
    return "Fits both saturated tails of the M(H) loop, removes the average susceptibility χ·H, and re-centres the loop on its saturation midpoint.";
  return `Cannot tell M(T) from M(H) — ${reason}. Pick the data type to continue.`;
}

export default function MagToolsPanel() {
  const setOpen = useApp((s) => s.setMagToolsOpen);
  const m = useMagTools();
  // The readout's units: a slope/χ is moment per x, an intercept/offset is moment.
  const xU = m.source ? (m.source.fromField ?? m.source.xUnit) : "";
  const mU = m.source?.fromMoment ?? "";
  const perX = mU && xU ? ` ${mU}/${xU}` : "";
  const inM = mU ? ` ${mU}` : "";

  return (
    <ToolWindow id="magtools" title="Magnetometry" width={400} onClose={() => setOpen(false)}>
      <SegmentedControl<MagTab>
        options={[
          { value: "background", label: "Background" },
          { value: "units", label: "Units" },
          { value: "demag", label: "Internal field" },
          { value: "curie-weiss", label: "Curie–Weiss" },
        ]}
        value={m.tab}
        onChange={m.setTab}
      />

      {!m.active && (
        <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
          Select a dataset first.
        </div>
      )}

      {m.tab === "background" ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <label className="qzk-field-lbl" style={{ margin: 0 }} htmlFor="magbg-mode">
              Data type
            </label>
            <Select
              id="magbg-mode"
              options={BG_MODE_OPTS}
              value={m.bgMode}
              onChange={(e) => m.setBgMode(e.target.value as MagBgMode)}
            />
          </div>
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginBottom: 10 }}>
            {bgDescription(m.bgPath, m.detection.reason)}
            {m.bgMode === "auto" && m.bgPath && ` (${m.detection.reason})`}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {m.bgPath === "mh" ? (
              <>
                <label className="qzk-field-lbl" style={{ margin: 0 }} htmlFor="magbg-frac">
                  High-field fraction
                </label>
                <NumberField
                  id="magbg-frac"
                  value={m.hiFraction}
                  width={64}
                  step={0.05}
                  onChange={(v) =>
                    m.setHiFraction(Math.min(1, Math.max(0.01, Number(v) || DEFAULT_HI_FRACTION)))
                  }
                />
              </>
            ) : (
              <>
                <label className="qzk-field-lbl" style={{ margin: 0 }} htmlFor="magbg-frac">
                  High-T fraction
                </label>
                <NumberField
                  id="magbg-frac"
                  value={m.autoFraction}
                  width={64}
                  step={0.05}
                  onChange={(v) =>
                    m.setAutoFraction(
                      Math.min(1, Math.max(0.01, Number(v) || DEFAULT_AUTO_FRACTION)),
                    )
                  }
                />
              </>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={!m.active || m.busy || !m.bgPath}
              onClick={() => void m.subtractBackground()}
            >
              {m.busy ? "Working…" : "Subtract background →"}
            </Button>
          </div>
          {m.fit && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
              {m.fit.kind === "mh"
                ? `removed: χ ${fmtNum(m.fit.slope)}${perX}, offset ${fmtNum(m.fit.offset)}${inM}`
                : `fit: slope ${fmtNum(m.fit.slope)}${perX}, intercept ${fmtNum(m.fit.intercept)}${inM}`}
            </div>
          )}
        </div>
      ) : m.tab === "units" ? (
        <NormalizationPane />
      ) : m.tab === "demag" ? <DemagCorrectionPane /> : <CurieWeissPane />}

      {m.tab === "background" && m.warning && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--warn)" }}>
          {m.warning}
        </div>
      )}
      {m.tab === "background" && m.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {m.error}
        </div>
      )}
    </ToolWindow>
  );
}
