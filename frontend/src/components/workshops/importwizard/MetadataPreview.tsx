import type { ImportPreviewResponse } from "../../../lib/types";

export default function MetadataPreview({ preview }: { preview: ImportPreviewResponse }) {
  const fields = Object.entries(preview.header_fields ?? {});
  const duplicates = preview.header_field_problems ?? [];
  if (fields.length === 0 && duplicates.length === 0 && preview.comments.length === 0) return null;

  return (
    <section aria-labelledby="import-metadata-heading" style={{ marginTop: 10 }}>
      <h3 id="import-metadata-heading" style={{ marginBottom: 5 }}>Detected metadata</h3>
      {duplicates.length > 0 && (
        <div role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--warn)" }}>
          Repeated metadata {duplicates.length === 1 ? "key" : "keys"}: {duplicates.map((p) => p.key).join(", ")}.
          The last value in the file will be used.
        </div>
      )}
      {fields.length > 0 && (
        <dl className="qzk-ds-meta" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "3px 10px", margin: "6px 0" }}>
          {fields.map(([key, value]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt style={{ color: "var(--text-faint)" }}>{key}</dt>
              <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {preview.comments.length > 0 && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Other preamble retained as searchable metadata: {preview.comments.join(" · ")}
        </div>
      )}
    </section>
  );
}
