// The part of the ternary and vector-field panels that is the same: title +
// format + Export on one row, the one-sentence rows-left-out notice, the
// reason nothing can be drawn, and the server-rendered preview image.

import { Button, Select } from "../../primitives";
import type { FigurePreview } from "./auxFigurePreview";

export type AuxFigureFormat = "pdf" | "svg" | "png";

const FORMATS = [
  { value: "pdf", label: "PDF" },
  { value: "svg", label: "SVG" },
  { value: "png", label: "PNG" },
];

const faint = { color: "var(--text-faint)" } as const;

export default function AuxFigureFrame({
  title,
  setTitle,
  fmt,
  setFmt,
  onExport,
  notice,
  problem,
  preview,
  alt,
}: {
  title: string;
  setTitle: (title: string) => void;
  fmt: AuxFigureFormat;
  setFmt: (fmt: AuxFigureFormat) => void;
  onExport: () => void;
  notice: string | null;
  problem: string | null;
  preview: FigurePreview;
  alt: string;
}) {
  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="qzk-field-lbl" htmlFor={`${alt}-title`}>Title</label>
          <input id={`${alt}-title`} className="qz-input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div>
          <label className="qzk-field-lbl">Format</label>
          <Select aria-label="Format" options={FORMATS} value={fmt} onChange={(e) => setFmt(e.target.value as AuxFigureFormat)} />
        </div>
        <Button size="sm" variant="primary" disabled={!!problem} onClick={onExport}>
          Export
        </Button>
      </div>

      {notice && (
        <div className="qzk-ds-meta" style={{ ...faint, marginTop: 8 }}>
          {notice}
        </div>
      )}
      {problem && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, var(--text-faint))" }}>
          {problem}
        </div>
      )}
      {!problem && preview.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, var(--text-faint))" }}>
          {preview.error}
        </div>
      )}
      {!problem && preview.busy && (
        <div className="qzk-ds-meta" style={{ ...faint, marginTop: 8 }}>
          rendering…
        </div>
      )}
      {!problem && preview.preview && (
        <img
          src={preview.preview}
          alt={alt}
          style={{ display: "block", width: "100%", marginTop: 10, opacity: preview.busy ? 0.6 : 1 }}
        />
      )}
    </>
  );
}
