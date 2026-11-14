// Data-driven marks for one series (gap audit 3, N5 + N6) — marker size from a
// column, drop lines to an axis, and the Spline line connect. Shared by the
// Inspector's Series style card and the Plot Details dialog (same pattern as
// `SeriesSymbolErrorControls`), and lazy with both: the canvas reads the fields
// in `colorscatter` / `uplotDropLines` / `uplotSpline`, the export in
// `calc/figure_sizes.py` / `calc/figure_marks.py`.

import { channelSplineEligible } from "../../lib/cubicSpline";
import { DEFAULT_SIZE_RANGE, sizeRange } from "../../lib/sizescatter";
import type { DropLines, SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Checkbox } from "../primitives/Checkbox";
import { NumberField } from "../primitives/NumberField";
import { Select } from "../primitives";
import { useEffectiveComposition } from "../Stage/useEffectiveComposition";

const row = { display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" } as const;

const DROPS: { value: DropLines | "none"; label: string }[] = [
  { value: "none", label: "None" },
  { value: "x", label: "To X axis" },
  { value: "y", label: "To Y axis" },
  { value: "both", label: "Both axes" },
];

interface Props {
  channel: number;
  style: SeriesStyle;
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>, coalesce?: string) => void;
}

const BREAK_NOTICE =
  "Not drawn in x-break panels (the export says so too): this series shows as an ordinary line there.";

export default function SeriesMarkMapControls({ channel, style, setSeriesStyle: apply }: Props) {
  const active = useApp((s) => s.datasets.find((d) => d.id === s.activeId) ?? null);
  const data = active?.data;
  const setStatus = useApp((s) => s.setStatus);
  const broken = useEffectiveComposition(active)?.kind === "break";
  const asked = style.sizeBy != null || !!style.dropLines || !!style.connect;
  // Spline / size-by / drop lines are not drawn in x-break panels: say so in the plot status too.
  const setSeriesStyle: Props["setSeriesStyle"] = (ch, patch, coalesce) => {
    apply(ch, patch, coalesce);
    if (broken && (patch.sizeBy != null || patch.dropLines || patch.connect)) setStatus(BREAK_NOTICE);
  };
  const xKey = useApp((s) => s.xKey);
  const labels = data?.labels ?? [];
  const others = labels.map((lab, i) => ({ i, lab })).filter(({ i }) => i !== channel);
  const [minPx, maxPx] = sizeRange(style.sizeRange);
  const setRange = (which: 0 | 1) => (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    const next: [number, number] = which === 0 ? [n, maxPx] : [minPx, n];
    if (next[0] <= next[1]) setSeriesStyle(channel, { sizeRange: next });
  };
  // Spline only where X is strictly ascending; otherwise it draws straight, in
  // row order, and says so (the export warns the same).
  const straight = style.connect === "spline" && !!data && !channelSplineEligible(data, xKey, channel);

  return (
    <>
      <div style={row}>
        <Checkbox
          checked={style.sizeBy != null}
          onChange={(c) => setSeriesStyle(channel, { sizeBy: c ? (others[0]?.i ?? channel) : undefined, sizeRange: undefined })}
        >
          Size by
        </Checkbox>
        {style.sizeBy != null && (
          <>
            <Select
              aria-label="Size-by channel"
              title="Column that sets each marker's size"
              options={labels.map((lab, i) => ({ value: String(i), label: lab }))}
              value={String(style.sizeBy)}
              onChange={(e) => setSeriesStyle(channel, { sizeBy: Number(e.target.value) })}
            />
          </>
        )}
      </div>
      {style.sizeBy != null && (
        <div style={row}>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>Size</span>
          <NumberField
            aria-label="Smallest marker size" title="Marker size at the column's minimum" unit="px" width={44}
            value={String(minPx)} placeholder={String(DEFAULT_SIZE_RANGE[0])} onChange={setRange(0)}
          />
          <span className="qzk-ds-meta">–</span>
          <NumberField
            aria-label="Largest marker size" title="Marker size at the column's maximum" unit="px" width={44}
            value={String(maxPx)} placeholder={String(DEFAULT_SIZE_RANGE[1])} onChange={setRange(1)}
          />
        </div>
      )}
      <div style={row}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>Drop lines</span>
        <Select
          aria-label="Drop lines"
          options={DROPS}
          value={style.dropLines ?? "none"}
          onChange={(e) => setSeriesStyle(channel, { dropLines: e.target.value === "none" ? undefined : (e.target.value as DropLines) })}
        />
      </div>
      <div style={row}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>Connect</span>
        <Select
          aria-label="Line connect"
          options={[{ value: "straight", label: "Straight" }, { value: "spline", label: "Spline" }]}
          value={style.connect ?? "straight"}
          onChange={(e) => setSeriesStyle(channel, { connect: e.target.value === "spline" ? "spline" : undefined })}
        />
      </div>
      {broken && asked && (
        <div className="qzk-ds-meta" role="status" style={{ marginTop: 4, color: "var(--warn, var(--text-faint))", whiteSpace: "normal" }}>
          {BREAK_NOTICE}
        </div>
      )}
      {straight && (
        <div className="qzk-ds-meta" role="status" style={{ marginTop: 4, color: "var(--warn, var(--text-faint))", whiteSpace: "normal" }}>
          X is not strictly ascending here (a loop or repeated X), so this series is drawn with straight segments in
          row order — a spline needs X to be a single-valued function.
        </div>
      )}
    </>
  );
}
