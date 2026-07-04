// Inspector card: the active dataset's import metadata (instrument header
// fields, Origin book/results-log provenance, …) as read-only key/value rows.
// Long values (e.g. an Origin results log) truncate for display; the Copy
// button exports every row at full length as TSV.

import { copyText } from "../../lib/clipboard";
import { metadataRows, metadataToTSV } from "../../lib/metadata";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Card } from "../primitives";

const DISPLAY_MAX = 220; // chars per value cell; full text goes out via Copy

export default function MetadataCard({ active }: { active: Dataset | null }) {
  const setStatus = useApp((s) => s.setStatus);
  const meta = (active?.data.metadata ?? {}) as Record<string, unknown>;
  const rows = metadataRows(meta);
  if (!active || rows.length === 0) return null;

  const copyAll = () =>
    copyText(metadataToTSV(meta)).then((ok) =>
      setStatus(ok ? `copied ${rows.length} metadata fields` : "clipboard unavailable"),
    );

  return (
    <Card title="Metadata" count={rows.length} defaultOpen={false}>
      <div>
        {rows.map(([k, v]) => (
          <div className="qz-meta-row" key={k}>
            <span className="qz-k" title={k}>
              {k}
            </span>
            <span className="qz-v" title={v.length > DISPLAY_MAX ? "truncated — use Copy for the full text" : v}>
              {v.length > DISPLAY_MAX ? `${v.slice(0, DISPLAY_MAX)}…` : v}
            </span>
          </div>
        ))}
      </div>
      <button type="button" className="qz-btn" onClick={copyAll} style={{ marginTop: 6 }}>
        ⧉ Copy metadata
      </button>
    </Card>
  );
}
