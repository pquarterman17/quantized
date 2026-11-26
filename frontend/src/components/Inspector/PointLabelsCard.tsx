// Inspector card: point labels from a column (gap audit 8, LBL). Pick a label
// column (text or numeric) and which points to label: all (crowded ones thinned),
// the rows selected in the worksheet, or the top N by |y|. OFF by default, saved
// with the graph, drawn in the live plot and the vector export from one layout
// (lib/pointLabelLayout.ts). The card shows that layout's own message: why
// nothing is drawn, or how many crowded labels were left out. With a label column
// set the hover readout also shows the row number and the label value.

import { categoricalLevels } from "../../lib/categorical";
import { layoutMessage } from "../../lib/pointLabelLayout";
import { DEFAULT_TOP_N, MAX_TOP_N, POINT_LABEL_MODE_NAMES, POINT_LABEL_MODES, type PointLabelMode } from "../../lib/pointLabels";
import { useActiveDataset, useApp } from "../../store/useApp";
import { usePointLabelLayout } from "../Stage/usePointLabelLayout";
import PointLabelAvoidControls from "./PointLabelAvoidControls";
import Card from "../primitives/Card";
import { Select } from "../primitives";

export default function PointLabelsCard() {
  const active = useActiveDataset();
  const spec = useApp((s) => s.pointLabels);
  const setPointLabels = useApp((s) => s.setPointLabels);
  const selection = useApp((s) => s.selection);
  const encoding = useApp((s) => s.plotWindows.find((w) => w.id === s.focusedWindowId)?.document?.bindings.encoding);
  const layout = usePointLabelLayout(active, selection, encoding);
  const message = spec ? layoutMessage(layout) : null;
  const data = active?.data;
  const columns = (data?.labels ?? []).map((name, i) => ({
    value: String(i),
    label: data && categoricalLevels(data, i) ? `${name} (text)` : name,
  }));
  return (
    <Card title="Point labels" count={spec ? 1 : undefined} defaultOpen={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label className="qzk-field-lbl">
          Label column
          <Select
            aria-label="Label column"
            options={[{ value: "", label: "None (off)" }, ...columns]}
            value={spec ? String(spec.key) : ""}
            onChange={(e) => {
              const v = e.target.value;
              setPointLabels(v === "" ? null : { key: Number(v), mode: spec?.mode ?? "top", topN: spec?.topN ?? DEFAULT_TOP_N, ...(spec?.avoid ? { avoid: spec.avoid } : {}) });
            }}
          />
        </label>
        {spec && (
          <>
            <label className="qzk-field-lbl">
              Label
              <Select
                aria-label="Which points"
                options={POINT_LABEL_MODES.map((m) => ({ value: m, label: POINT_LABEL_MODE_NAMES[m] }))}
                value={spec.mode}
                onChange={(e) => setPointLabels({ ...spec, mode: e.target.value as PointLabelMode })}
              />
            </label>
            {spec.mode === "top" && (
              <label className="qz-hint" style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: "var(--font-mono)" }}>
                N
                <input
                  type="number"
                  className="qz-input qz-num"
                  aria-label="Top N"
                  min={1}
                  max={MAX_TOP_N}
                  step={1}
                  value={spec.topN}
                  style={{ width: 72 }}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n) && n >= 1 && n <= MAX_TOP_N) setPointLabels({ ...spec, topN: n });
                  }}
                />
              </label>
            )}
            <PointLabelAvoidControls
              avoid={spec.avoid}
              onChange={(avoid) => setPointLabels({ key: spec.key, mode: spec.mode, topN: spec.topN, ...(avoid ? { avoid } : {}) })}
            />
            <div className="qz-hint" style={{ color: "var(--text-dim)", fontSize: 11 }}>
              Rows excluded or filtered out are not labelled. Hover shows the row number and label.
            </div>
            {message && (
              <div role="status" className="qz-hint" style={{ color: "var(--text-dim)", fontSize: 11 }}>
                {message}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
