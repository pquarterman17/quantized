// Vector field workshop — view (Origin gap #23's frontend half). Pick the
// X, Y, U, V columns and quiver or streamline; the preview is the route's
// own PNG render of the exact gridded request Export sends. Thin — the
// picks, gridding and preview live in useFieldPlot; the title/format/export
// row and the preview image are the ternary panel's AuxFigureFrame.

import ToolWindow from "../../overlays/ToolWindow";
import { Select } from "../../primitives";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import AuxFigureFrame from "../ternary/AuxFigureFrame";
import { useAuxFigureStore } from "../ternary/auxFigureStore";
import { useFieldPlot, type FieldKind } from "./useFieldPlot";

const WELLS = [
  ["x", "X"],
  ["y", "Y"],
  ["u", "U (x component)"],
  ["v", "V (y component)"],
] as const;

const KINDS: { value: FieldKind; label: string }[] = [
  { value: "quiver", label: "Quiver" },
  { value: "streamline", label: "Streamline" },
];

export default function FieldPlotPanel() {
  const setOpen = useAuxFigureStore((s) => s.setFieldOpen);
  const f = useFieldPlot();
  const colOptions = f.columns.map((c) => ({ value: String(c.index), label: c.label }));

  return (
    <ToolWindow id="fieldplot" title="Vector field" width={600} onClose={() => setOpen(false)}>
      {!f.hasData ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset with X, Y, U and V columns.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            {WELLS.map(([key, label]) => (
              <div key={key} style={{ flex: 1 }}>
                <label className="qzk-field-lbl">{label}</label>
                <Select
                  aria-label={label}
                  options={colOptions}
                  value={String(f.picks[key])}
                  onChange={(e) => f.setPick(key, Number(e.target.value))}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <SegmentedControl options={KINDS} value={f.kind} onChange={f.setKind} />
          </div>
          <AuxFigureFrame
            title={f.title}
            setTitle={f.setTitle}
            fmt={f.fmt}
            setFmt={f.setFmt}
            onExport={() => void f.exportNow()}
            notice={f.notice}
            problem={f.problem}
            preview={f.preview}
            alt="Vector field preview"
          />
        </>
      )}
    </ToolWindow>
  );
}
