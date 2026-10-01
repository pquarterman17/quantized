// Ternary diagram workshop — view (Origin gap #23's frontend half). Pick the
// three composition columns and an optional colour column; the preview is
// the route's own PNG render of the exact request Export sends. Thin — the
// picks, request and preview live in useTernary; the title/format/export
// row and the preview image are AuxFigureFrame, shared with the vector
// field panel.

import ToolWindow from "../../overlays/ToolWindow";
import { Select } from "../../primitives";
import AuxFigureFrame from "./AuxFigureFrame";
import { useAuxFigureStore } from "./auxFigureStore";
import { useTernary } from "./useTernary";

const CORNERS = [
  ["a", "A (top)"],
  ["b", "B (left)"],
  ["c", "C (right)"],
] as const;

export default function TernaryPanel() {
  const setOpen = useAuxFigureStore((s) => s.setTernaryOpen);
  const t = useTernary();
  const colOptions = t.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const colourOptions = [{ value: "", label: "none" }, ...colOptions.filter((o) => o.value !== "-1")];

  return (
    <ToolWindow id="ternary" title="Ternary diagram" width={560} onClose={() => setOpen(false)}>
      {!t.hasData ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset with three composition columns.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            {CORNERS.map(([key, label]) => (
              <div key={key} style={{ flex: 1 }}>
                <label className="qzk-field-lbl">{label}</label>
                <Select
                  aria-label={label}
                  options={colOptions}
                  value={String(t.picks[key])}
                  onChange={(e) => t.setPick(key, Number(e.target.value))}
                />
              </div>
            ))}
            <div style={{ flex: 1 }}>
              <label className="qzk-field-lbl">Colour by</label>
              <Select
                aria-label="Colour by"
                options={colourOptions}
                value={t.picks.colorBy === null ? "" : String(t.picks.colorBy)}
                onChange={(e) => t.setPick("colorBy", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
          </div>
          <AuxFigureFrame
            title={t.title}
            setTitle={t.setTitle}
            fmt={t.fmt}
            setFmt={t.setFmt}
            onExport={() => void t.exportNow()}
            notice={t.notice}
            problem={t.problem}
            preview={t.preview}
            alt="Ternary preview"
          />
        </>
      )}
    </ToolWindow>
  );
}
