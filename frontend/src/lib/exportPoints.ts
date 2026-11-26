// Width and size numbers (line, marker, error bar, shape stroke) travel to the
// export unchanged and matplotlib reads them as typographic POINTS. The canvas
// draws the same number as a CSS pixel, so it is a screen-scale preview.
// Owner decision 2026-11-26 (OG14): this is accepted and the UI says so.
export const PT_EXPORT_HINT = "In points in the exported figure; the canvas previews the same number at screen scale.";
