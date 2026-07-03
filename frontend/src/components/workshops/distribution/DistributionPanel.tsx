// Distribution platform (#52) — view. A draggable ToolWindow: pick a column and
// see its histogram, descriptive stats, and a Shapiro-Wilk normality verdict in
// one linked panel. Bars are DOM (not canvas) so the whole panel is testable.
// Thin — composition + fetching live in useDistribution.

import { fmtNum } from "../../../lib/format";
import ToolWindow from "../../overlays/ToolWindow";
import { Select, StatusDot } from "../../primitives";
import { useApp } from "../../../store/useApp";
import { useDistribution } from "./useDistribution";

const STAT_FIELDS: { key: string; label: string }[] = [
  { key: "N", label: "N" },
  { key: "mean", label: "mean" },
  { key: "median", label: "median" },
  { key: "std", label: "std" },
  { key: "min", label: "min" },
  { key: "max", label: "max" },
];

export default function DistributionPanel() {
  const setOpen = useApp((s) => s.setDistributionOpen);
  const d = useDistribution();
  const colOptions = d.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const maxCount = d.hist ? Math.max(1, ...d.hist.counts) : 1;
  const isNormal = d.norm ? d.norm.p >= 0.05 : null;

  return (
    <ToolWindow title="Distribution" width={380} onClose={() => setOpen(false)}>
      {!d.hasData ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to profile.
        </div>
      ) : (
        <>
          <label className="qzk-field-lbl">Column</label>
          <Select
            options={colOptions}
            value={String(d.col)}
            onChange={(e) => d.setCol(Number(e.target.value))}
          />

          {d.error ? (
            <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
              {d.error}
            </div>
          ) : (
            <>
              {/* Histogram — DOM bars, height ∝ count. */}
              <div
                className="qzk-hist"
                aria-label="histogram"
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 1,
                  height: 96,
                  marginTop: 12,
                  padding: "0 2px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {d.hist?.counts.map((c, i) => (
                  <div
                    key={i}
                    className="qzk-hist-bar"
                    title={`[${fmtNum(d.hist!.edges[i])}, ${fmtNum(d.hist!.edges[i + 1])}): ${c}`}
                    style={{
                      flex: 1,
                      height: `${(c / maxCount) * 100}%`,
                      minHeight: c > 0 ? 1 : 0,
                      background: "var(--series-1, var(--accent))",
                    }}
                  />
                ))}
              </div>

              {/* Descriptive stats. */}
              <div
                className="qzk-ds-meta"
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "auto auto auto auto",
                  gap: "4px 12px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {STAT_FIELDS.map((f) => (
                  <span key={f.key}>
                    <span style={{ color: "var(--text-faint)" }}>{f.label} </span>
                    {fmtNum(d.desc?.[f.key])}
                  </span>
                ))}
              </div>

              {/* Normality verdict. */}
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                {d.norm ? (
                  <StatusDot
                    tone={isNormal ? "ok" : "warn"}
                    label={
                      <span>
                        {isNormal ? "Consistent with normal" : "Not normal"} · Shapiro–Wilk W=
                        {fmtNum(d.norm.W)}, p={fmtNum(d.norm.p)}
                      </span>
                    }
                  />
                ) : (
                  <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
                    Normality: {d.normNote ?? "—"}
                  </span>
                )}
              </div>
            </>
          )}
        </>
      )}
    </ToolWindow>
  );
}
