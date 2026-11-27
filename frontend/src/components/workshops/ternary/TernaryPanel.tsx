// Ternary diagram workshop — view (Origin gap #23's frontend half). Pick the
// three composition columns and an optional colour column; the preview is
// the route's own PNG render of the exact request Export sends. Thin — the
// picks, request and preview live in useTernary; the title/format/export
// row and the preview image are AuxFigureFrame, shared with the vector
// field panel.

import ToolWindow from "../../overlays/ToolWindow";
import { Select } from "../../primitives";
import ToolInputSummary from "../analysisselection/ToolInputSummary";
import AuxFigureFrame from "./AuxFigureFrame";
import { useAuxFigureStore } from "./auxFigureStore";
import TernaryFieldControls from "./TernaryFieldControls";
import { useTernary } from "./useTernary";

const TEXT_PREFIX = "text:"; // a channel option is all digits, so the prefix cannot collide

const CORNERS = [
  ["a", "A (top)"],
  ["b", "B (left)"],
  ["c", "C (right)"],
] as const;

const ENDS = [
  ["ea", "A end"],
  ["eb", "B end"],
  ["ec", "C end"],
] as const;

/** What the optional fourth column does for each draw type. */
const FOURTH: Record<string, string> = { scatter: "Color by", contour: "Z (value)", heatmap: "Z (value)", line: "Series by", vector: "Color by" };

export default function TernaryPanel() {
  const setOpen = useAuxFigureStore((s) => s.setTernaryOpen);
  const t = useTernary();
  const colOptions = t.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const fourth = FOURTH[t.field.kind] ?? "Color by";
  const vector = t.field.kind === "vector";
  const textOptions = t.field.kind === "line" ? t.textColumns.map((name) => ({ value: TEXT_PREFIX + name, label: `${name} (text column)` })) : [];
  const colourOptions = [{ value: "", label: "none" }, ...colOptions.filter((o) => o.value !== "-1"), ...textOptions];

  return (
    <ToolWindow id="ternary" title="Ternary diagram" width={560} onClose={() => setOpen(false)}>
      {!t.hasData ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
          Select a dataset with three composition columns.
        </div>
      ) : (
        <>
          <ToolInputSummary
            noX
            load={false}
            columns={[
              t.picks.a,
              t.picks.b,
              t.picks.c,
              ...(vector ? [t.picks.ea ?? -1, t.picks.eb ?? -1, t.picks.ec ?? -1] : []),
              ...(t.picks.colorBy === null ? [] : [t.picks.colorBy]),
            ]}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
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
              <label className="qzk-field-lbl">{fourth}</label>
              <Select
                aria-label={fourth}
                options={colourOptions}
                value={t.picks.seriesText !== undefined && t.field.kind === "line" ? TEXT_PREFIX + t.picks.seriesText : t.picks.colorBy === null ? "" : String(t.picks.colorBy)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith(TEXT_PREFIX)) t.setSeriesText(v.slice(TEXT_PREFIX.length));
                  else t.setPick("colorBy", v === "" ? null : Number(v));
                }}
              />
            </div>
          </div>
          {vector && (
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              {ENDS.map(([key, label]) => (
                <div key={key} style={{ flex: 1 }}>
                  <label className="qzk-field-lbl">{label}</label>
                  <Select
                    aria-label={label}
                    options={colOptions}
                    value={String(t.picks[key] ?? -1)}
                    onChange={(e) => t.setPick(key, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          )}
          <TernaryFieldControls field={t.field} setField={t.setField} colored={t.picks.colorBy !== null} />
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
