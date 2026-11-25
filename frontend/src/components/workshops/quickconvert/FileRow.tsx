// Quick Convert: one file in the list. Name and folder, the guessed type, the
// output format and names, a status in words (never colour alone), and a
// details section (datasets, columns and units, every output name).

import { useId, useState } from "react";
import clsx from "clsx";

import type { ConvertEntry, FilePreview, FormatInfo } from "../../../lib/api/convertQuick";
import { columnText, folderOf, joinPath, type QcFile, type RowStatus } from "./quickConvertModel";
import { fmtInt } from "../../../lib/locale";

interface Props {
  file: QcFile;
  preview: FilePreview | undefined;
  entry: ConvertEntry | undefined;
  status: RowStatus;
  formats: FormatInfo[];
  outDir: string;
  locked: boolean;
  onRemove: () => void;
}

const MARK: Record<RowStatus["tone"], string> = { ok: "✓", warn: "!", danger: "✕", dim: "…" };

export default function FileRow({ file, preview, entry, status, formats, outDir, locked, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const guessed = !!preview && (preview.format_source.startsWith("default") || preview.format_source.startsWith("auto"));
  const fmtLabel = preview?.format ? (formats.find((f) => f.id === preview.format)?.label ?? preview.format) : "";
  const where = outDir.trim() || (file.staged ? "" : folderOf(file.path));
  const outputs = entry?.outputs.length ? entry.outputs : (preview?.outputs ?? []);
  return (
    <li className="qzk-qc-row" data-tone={status.tone}>
      <div className="qzk-qc-line">
        <button
          type="button"
          className="qzk-qc-toggle"
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={`${open ? "Hide" : "Show"} details for ${file.name}`}
          onClick={() => setOpen(!open)}
        >
          {open ? "▾" : "▸"}
        </button>
        <span className="qzk-qc-name" title={file.staged ? file.name : file.path}>
          <strong>{file.name}</strong>
          <span className="qzk-qc-dim">{file.staged ? "uploaded copy" : folderOf(file.path)}</span>
        </span>
        <span className="qzk-qc-kind" title={preview?.technique || undefined}>
          {preview?.kind_label || (preview?.error ? "Unknown type" : "")}
        </span>
        <span className="qzk-qc-fmt" title={preview?.format_source || undefined}>
          {fmtLabel}
          {guessed && fmtLabel ? <span className="qzk-qc-dim"> (guessed)</span> : null}
        </span>
        <span className={clsx("qzk-qc-status", `qzk-qc-${status.tone}`)} title={status.detail}>
          <span aria-hidden="true">{MARK[status.tone]} </span>
          {status.label}
        </span>
        <button
          type="button"
          className="qzk-qc-remove"
          aria-label={`Remove ${file.name}`}
          title="Remove from the list (the file itself is untouched)"
          disabled={locked}
          onClick={onRemove}
        >
          ✕
        </button>
      </div>
      {status.detail && (
        <p className={clsx("qzk-qc-reason", status.tone === "danger" && "qzk-qc-danger")} role={status.tone === "danger" ? "alert" : undefined}>
          {status.detail}
        </p>
      )}
      {open && (
        <div id={detailId} className="qzk-qc-detail">
          {preview?.datasets.length ? (
            <ul>
              {preview.datasets.map((d, i) => (
                <li key={`${d.name}-${i}`}>
                  <strong>{d.name}</strong> · {fmtInt(d.rows)} rows{d.is_map ? " · 2-D map" : ""}
                  <br />
                  <span className="qzk-qc-mono">{columnText(d.columns)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="qzk-qc-dim">No dataset information{preview?.error ? " (the file could not be read)." : " yet."}</p>
          )}
          {outputs.length > 0 && (
            <p>
              {entry ? "Written" : "Will write"}:{" "}
              <span className="qzk-qc-mono">{outputs.map((n) => (where ? joinPath(where, n) : n)).join("  ·  ")}</span>
              {!where && file.staged ? <span className="qzk-qc-dim"> (in the output folder you choose)</span> : null}
            </p>
          )}
          {outputs.some((n) => n.startsWith(`${file.name}.`)) && (
            <p className="qzk-qc-dim">
              Note: the output keeps the input&apos;s full name plus the new extension ({file.name} gives {outputs[0]}), so{" "}
              {file.name} and a same-named file of another type never share an output. Provisional, owner to confirm.
            </p>
          )}
          {[...(preview?.notes ?? []), ...(entry?.notes ?? []), ...(entry?.books.flatMap((b) => b.notes) ?? [])].map((n, i) => (
            <p key={i} className="qzk-qc-dim">
              Note: {n}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}
