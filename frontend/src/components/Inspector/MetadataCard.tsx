// Inspector card: the active dataset's free-form .metadata (instrument header
// fields the parser captured). Read-only key/value rows + a copy-as-TSV button.
// Hidden when there's no dataset or no metadata to show.

import { copyText } from "../../lib/clipboard";
import { metadataRows, metadataToTSV } from "../../lib/metadata";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Card, MetaRow } from "../primitives";

export default function MetadataCard({ active }: { active: Dataset | null }) {
  const setStatus = useApp((s) => s.setStatus);
  if (!active) return null;
  const rows = metadataRows(active.data.metadata);
  if (rows.length === 0) return null;

  const copy = () =>
    copyText(metadataToTSV(active.data.metadata)).then((ok) =>
      setStatus(ok ? `copied ${rows.length} metadata fields` : "clipboard unavailable"),
    );

  return (
    <Card title={`Metadata (${rows.length})`} defaultOpen={false}>
      {rows.map(([k, v]) => (
        <MetaRow key={k} label={k} value={v} title={v} />
      ))}
      <button className="qz-btn" onClick={copy} title="Copy metadata as TSV" style={{ marginTop: 6 }}>
        Copy metadata
      </button>
    </Card>
  );
}
