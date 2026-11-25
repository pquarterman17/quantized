// The Publication preview's output block (UX audit 7, lane UX-H): the file
// format as a segmented control, the style preset under a human-readable
// name with its size, and a DPI field shown only for the raster formats
// (with the pixel size it gives). Every format offered here is one
// `routes/_export_common._FIGURE_MIME` accepts. Visible labels are the
// controls' accessible names (aria-labelledby), so the two cannot disagree.

import { useEffect, useId, useState } from "react";

import { exportDpiFor } from "../../../lib/exportPrefs";
import { FIGURE_FORMATS, RASTER_FORMATS } from "./figureOutputConstants";
import { presetOptions } from "../../../lib/figurePresets";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Button, Select } from "../../primitives";
import { toInches } from "../../../lib/pageGeometry";

/** The control's left-to-right order: the vector formats a journal wants
 *  first, then raster, then the legacy vector format. */
const FORMAT_ORDER = ["pdf", "svg", "png", "tiff", "eps"];

const NOTE = { fontSize: "var(--font-size-sm)", color: "var(--text-dim)" } as const;
const MONO = { ...NOTE, fontFamily: "var(--font-mono)" } as const;

export default function FigureOutputControls({
  fmt, setFmt, style, setStyle, dpi, setDpi, sizeCm = null,
}: {
  fmt: string;
  setFmt: (next: string) => void;
  style: string;
  /** `keepDpi`: the user typed a DPI, so the preset must not replace it. */
  setStyle: (next: string, keepDpi?: boolean) => void;
  dpi: number;
  setDpi: (next: number) => void;
  /** The rendered figure's physical size (null until a settled preview). */
  sizeCm?: { widthCm: number; heightCm: number } | null;
}) {
  const id = useId();
  const raster = RASTER_FORMATS.includes(fmt);
  const formats = FORMAT_ORDER.filter((f) => FIGURE_FORMATS.includes(f));
  // A document carrying a format this build does not list keeps its own value
  // on screen rather than silently showing nothing selected.
  if (!formats.includes(fmt)) formats.push(fmt);

  // DPI keeps its own in-progress text (PropertyNumberField's pattern): an
  // invalid or out-of-range keystroke must not immediately snap back to the
  // last committed value while the user is still typing.
  const [dpiText, setDpiText] = useState(String(dpi));
  const [dpiTyped, setDpiTyped] = useState(false);
  const committedDpiText = String(dpi);
  useEffect(() => {
    setDpiText(committedDpiText);
  }, [committedDpiText]);

  const presetDpi = exportDpiFor(style);
  const px = sizeCm ? [Math.round(toInches(sizeCm.widthCm, "cm") * dpi), Math.round(toInches(sizeCm.heightCm, "cm") * dpi)] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="qzk-field-lbl" id={`${id}-fmt`}>Format</span>
      <SegmentedControl
        aria-labelledby={`${id}-fmt`}
        options={formats.map((f) => ({ value: f, label: f.toUpperCase() }))}
        value={fmt}
        onChange={setFmt}
      />
      <label className="qzk-field-lbl" htmlFor={`${id}-preset`}>Preset</label>
      <Select
        id={`${id}-preset`}
        options={presetOptions(style)}
        value={style}
        onChange={(e) => setStyle(e.target.value, dpiTyped)}
      />
      {raster ? (
        <>
          <label className="qzk-field-lbl" htmlFor={`${id}-dpi`}>Resolution (dpi)</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <NumberField
              id={`${id}-dpi`}
              value={dpiText}
              onChange={(v) => {
                setDpiText(v);
                const n = Number(v);
                // Only commit a finite, sane DPI; an invalid/out-of-range
                // keystroke leaves the field text as typed and self-corrects
                // once the entry becomes valid. [50, 1200] is the backend's
                // own clamp (_export_common).
                if (Number.isFinite(n) && n >= 50 && n <= 1200) {
                  setDpiTyped(true);
                  setDpi(n);
                }
              }}
              width={70}
            />
            {px && <output aria-label="Raster size" style={MONO}>{px[0]} × {px[1]} px</output>}
          </div>
          {/* A typed DPI outlives preset changes; this puts the preset's back. */}
          {dpiTyped && presetDpi !== undefined && presetDpi !== dpi && (
            <Button size="sm" onClick={() => { setDpiTyped(false); setDpi(presetDpi); }}>
              Use the preset's {presetDpi} dpi
            </Button>
          )}
        </>
      ) : (
        <span style={NOTE}>Vector: lines and text stay sharp at any size.</span>
      )}
    </div>
  );
}
