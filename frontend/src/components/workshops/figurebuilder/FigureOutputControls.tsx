// The Publication preview's output block (UX audit 7, lane UX-H): the file
// format as a segmented control, the style preset under a human-readable
// name with its size, and a DPI field shown only for the raster formats
// (vector output has no resolution, so a DPI field there only misleads).
// Every format offered here is one `routes/_export_common._FIGURE_MIME`
// accepts.

import { useEffect, useState } from "react";

import { FIGURE_FORMATS, RASTER_FORMATS } from "./figureOutputConstants";
import { presetOptions } from "./figurePresets";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Select } from "../../primitives";

/** The control's left-to-right order: the vector formats a journal wants
 *  first, then raster, then the legacy vector format. */
const FORMAT_ORDER = ["pdf", "svg", "png", "tiff", "eps"];

const LABEL_STYLE = { fontSize: "var(--font-size-sm)", color: "var(--text-dim)" } as const;

export default function FigureOutputControls({
  fmt, setFmt, style, setStyle, dpi, setDpi,
}: {
  fmt: string;
  setFmt: (next: string) => void;
  style: string;
  setStyle: (next: string) => void;
  dpi: number;
  setDpi: (next: number) => void;
}) {
  const raster = RASTER_FORMATS.includes(fmt);
  const formats = FORMAT_ORDER.filter((f) => FIGURE_FORMATS.includes(f));
  // A document carrying a format this build does not list keeps its own value
  // on screen rather than silently showing nothing selected.
  if (!formats.includes(fmt)) formats.push(fmt);

  // DPI keeps its own in-progress text (PropertyNumberField's pattern): an
  // invalid or out-of-range keystroke must not immediately snap back to the
  // last committed value while the user is still typing.
  const [dpiText, setDpiText] = useState(String(dpi));
  const committedDpiText = String(dpi);
  useEffect(() => {
    setDpiText(committedDpiText);
  }, [committedDpiText]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={LABEL_STYLE}>Format</span>
      <SegmentedControl
        aria-label="Figure format"
        options={formats.map((f) => ({ value: f, label: f.toUpperCase() }))}
        value={fmt}
        onChange={setFmt}
      />
      <span style={LABEL_STYLE}>Preset</span>
      <Select aria-label="Figure style" options={presetOptions(style)} value={style} onChange={(e) => setStyle(e.target.value)} />
      {raster ? (
        <label style={{ display: "flex", alignItems: "center", gap: 8, ...LABEL_STYLE }}>
          Resolution
          <NumberField
            aria-label="Figure DPI (raster)"
            value={dpiText}
            onChange={(v) => {
              setDpiText(v);
              const n = Number(v);
              // Only commit a finite, sane DPI; an invalid/out-of-range
              // keystroke leaves the field text as typed and self-corrects
              // once the entry becomes valid (no silent snap to 300, no
              // negative/absurd DPI reaching the export request).
              // [50, 1200] is the backend's own clamp (_export_common).
              if (Number.isFinite(n) && n >= 50 && n <= 1200) setDpi(n);
            }}
            width={70}
          />
          dpi
        </label>
      ) : (
        <span style={LABEL_STYLE}>Vector: lines and text stay sharp at any size.</span>
      )}
    </div>
  );
}
