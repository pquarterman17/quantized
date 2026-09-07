import type { ImportPreviewResponse } from "../../../lib/types";

export default function MetadataPreview({ preview }: { preview: ImportPreviewResponse }) {
  const fields = Object.entries(preview.header_fields ?? {});
  const duplicates = preview.header_field_problems ?? [];
  // `header_fields` is a PARSE of the very `comments` the same response
  // carries, so showing both renders every `key: value` line twice — a
  // preamble that is entirely `key: value` displayed its whole self twice.
  // The backend sends the complement (`import_metadata.unparsed_comments`);
  // fall back to the full list only for a response that predates the field,
  // which is the old, duplicated-but-complete behaviour rather than silently
  // hiding retained text.
  const leftover = preview.unparsed_comments ?? preview.comments;
  if (fields.length === 0 && duplicates.length === 0 && leftover.length === 0) return null;

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
        <dl className="qzk-ds-meta qzk-msg" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "3px 10px", margin: "6px 0" }}>
          {fields.map(([key, value]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt style={{ color: "var(--text-faint)" }}>{key}</dt>
              <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {leftover.length > 0 && (
        <div className="qzk-ds-meta qzk-msg" style={{ color: "var(--text-faint)" }}>
          Other preamble retained as searchable metadata: {leftover.join(" · ")}
        </div>
      )}
    </section>
  );
}
