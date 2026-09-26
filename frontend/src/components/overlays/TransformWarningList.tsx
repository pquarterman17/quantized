// P2.5 transform-safety preview: the warnings a combine/reshape would produce,
// rendered inline in a dialog BEFORE the user commits (Split by column value,
// Dataset Math, Resample, Reshape & combine). The append import shows the
// same sentences in its review confirm (lib/transformRun.reviewTransform).
// Only lazy dialogs import this.

import type { TransformWarning } from "../../lib/transformWarnings";

export default function TransformWarningList({ warnings }: { warnings: readonly TransformWarning[] }) {
  if (!warnings.length) return null;
  return (
    <ul
      aria-label="Transform warnings"
      className="qzk-ds-meta"
      style={{ margin: "8px 0 0", paddingLeft: 16, display: "grid", gap: 4 }}
    >
      {warnings.map((w) => (
        <li
          key={`${w.code}:${w.text}`}
          data-code={w.code}
          style={{ color: w.confirm ? "var(--danger)" : w.info ? "var(--text-faint)" : "var(--warn, var(--text))" }}
        >
          {w.text}
        </li>
      ))}
    </ul>
  );
}
