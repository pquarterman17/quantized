// Default x of an analysis tool window `width` px wide: docked at the RIGHT
// edge, clear of the plot's Y axis and the Library (x = 120, ToolWindow's
// default, sat on both). Shared by Curve Fit and the Peak Analyzer.

export function dockedX(width: number): number {
  return typeof window === "undefined" ? 120 : Math.max(16, window.innerWidth - width - 16);
}
