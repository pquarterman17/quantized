// The preview's render warnings (publication-figures audit #7/#11): what the
// export could not honour — a font that is not installed, a reference line or
// shade outside the axis range, a page too small for its labels. The preview
// is the export's own render, so it shows the same list Export toasts
// (`calc.figure_warnings`, the hit-map's `warnings`).

export default function PreviewWarnings({ warnings }: { warnings?: readonly string[] }) {
  if (!warnings?.length) return null;
  return (
    <ul role="status" aria-label="Export warnings" className="qzk-ds-meta qzk-msg" style={{ margin: "6px 0 0", paddingLeft: 16, maxWidth: "100%", color: "var(--warn)" }}>
      {warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}
