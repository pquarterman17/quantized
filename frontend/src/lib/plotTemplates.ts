// On-screen plot templates — the live analog of the server-side export style
// presets (#16). A template sets the plot's base font size and line width so the
// interactive plot roughly matches what a publication/presentation export will
// look like. Per-series width overrides still win over the template's base width.

export interface PlotTemplate {
  value: string;
  label: string;
  fontSize: number; // axis tick/label font px
  lineWidth: number; // default series stroke px (when no per-series override)
}

export const PLOT_TEMPLATES: PlotTemplate[] = [
  { value: "screen", label: "Screen (default)", fontSize: 11, lineWidth: 1.5 },
  { value: "aps", label: "APS (compact)", fontSize: 9, lineWidth: 1.0 },
  { value: "nature", label: "Nature", fontSize: 9, lineWidth: 1.2 },
  { value: "thesis", label: "Thesis", fontSize: 11, lineWidth: 1.5 },
  { value: "report", label: "Report", fontSize: 11, lineWidth: 1.75 },
  { value: "presentation", label: "Presentation", fontSize: 14, lineWidth: 2.5 },
  { value: "poster", label: "Poster", fontSize: 18, lineWidth: 3.5 },
];

export function resolveTemplate(value: string): PlotTemplate {
  return PLOT_TEMPLATES.find((t) => t.value === value) ?? PLOT_TEMPLATES[0];
}
