// Pack Project — the "Flagged files" section. An untrusted .dwk can declare
// any path as a source; the backend preview flags a packable source outside
// the data folders or of an unrecognised type (`attention`). They are left
// out of the bundle unless the user ticks the explicit confirm below.

import { useId } from "react";

import type { PortableSourceRow } from "../../../lib/desktopPackBridge";

/** Packable rows the preview flagged as needing attention. */
export function flaggedSources(sources: PortableSourceRow[]): PortableSourceRow[] {
  return sources.filter((s) => s.packable && (s.attention?.length ?? 0) > 0);
}

interface Props {
  flagged: PortableSourceRow[];
  include: boolean;
  onIncludeChange: (include: boolean) => void;
}

export default function PackAttention({ flagged, include, onIncludeChange }: Props) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>Flagged files</h3>
      <ul>
        {flagged.map((s) => (
          <li key={s.source_id}>
            <span title={s.original_path} style={{ overflowWrap: "anywhere" }}>{s.original_path}</span>
            {" — "}
            {(s.attention ?? []).map((a) => a.reason).join("; ")}
          </li>
        ))}
      </ul>
      <p className="qzk-ds-meta qzk-msg">Flagged files are left out of the bundle unless you include them.</p>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={include} onChange={(e) => onIncludeChange(e.target.checked)} />
        Include flagged files
      </label>
    </section>
  );
}
