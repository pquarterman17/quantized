// Quick Convert: the body of the converter window. The same component is the
// standalone page (`/convert`, nothing else mounted) and the in-app panel
// (File > Export > Quick Convert…). Files by drop, "Add files…" or the files
// `qz convert --gui` was started with; an output folder (default: next to each
// input); a format ("Auto (guessed)" or one); an overwrite tick, off.

import { useId, useState } from "react";

import { Button } from "../../primitives";
import "./quickConvert.css";
import DropZone from "./DropZone";
import FileRow from "./FileRow";
import OptionsPanel from "./OptionsPanel";
import PathChooser from "./PathChooser";
import ResultSummary from "./ResultSummary";
import { rowStatus, folderOf } from "./quickConvertModel";
import { useQuickConvert } from "./useQuickConvert";

export default function QuickConvertView({ prefill = false }: { prefill?: boolean }) {
  const qc = useQuickConvert(prefill);
  const [chooser, setChooser] = useState<"files" | "folder" | null>(null);
  const blockId = useId();
  const running = qc.job.phase === "running";
  const formats = qc.config?.formats ?? [];

  if (qc.configError)
    return (
      <p role="alert" className="qzk-qc-danger">
        Could not reach Quantized: {qc.configError}
      </p>
    );
  if (chooser)
    return (
      <PathChooser
        mode={chooser}
        start={chooser === "folder" ? qc.outDir.trim() : folderOf(qc.files.at(-1)?.path ?? "")}
        onCancel={() => setChooser(null)}
        onPick={(paths) => {
          if (chooser === "files") qc.addPaths(paths);
          else qc.setOutDir(paths[0] ?? "");
          setChooser(null);
        }}
      />
    );

  const entries = qc.job.result?.report.files ?? [];
  return (
    <div className="qzk-qc">
      <DropZone empty={qc.files.length === 0} disabled={running} onBrowse={() => setChooser("files")} onFiles={(f) => void qc.addFiles(f)} />

      {qc.files.length > 0 && (
        <>
          <div className="qzk-qc-head" aria-hidden="true">
            <span />
            <span>File</span>
            <span>Type (guessed)</span>
            <span>Output format</span>
            <span>Status</span>
            <span />
          </div>
          <ul className="qzk-qc-files" aria-label="Files to convert">
            {qc.files.map((f) => {
              const idx = qc.job.paths.indexOf(f.path);
              const entry = idx >= 0 ? entries[idx] : undefined;
              const preview = qc.previewOf(f.path);
              return (
                <FileRow
                  key={f.id}
                  file={f}
                  preview={preview}
                  entry={entry}
                  status={rowStatus(f, preview, entry, { running, overwrite: qc.overwrite })}
                  formats={formats}
                  outDir={qc.outDir}
                  locked={running}
                  onRemove={() => qc.removeFile(f.id)}
                />
              );
            })}
          </ul>
          {qc.previewError && (
            <p role="alert" className="qzk-qc-note qzk-qc-danger">
              {qc.previewError}
            </p>
          )}
        </>
      )}

      <OptionsPanel
        formats={formats}
        outDir={qc.outDir}
        onOutDir={qc.setOutDir}
        outStatus={qc.outStatus}
        needsFolder={qc.needsFolder}
        format={qc.format}
        onFormat={qc.setFormat}
        overwrite={qc.overwrite}
        onOverwrite={qc.setOverwrite}
        metadata={qc.metadata}
        onMetadata={qc.setMetadata}
        report={qc.report}
        onReport={qc.setReport}
        onBrowse={() => setChooser("folder")}
        disabled={running}
      />

      <div className="qzk-qc-actions">
        <Button variant="primary" onClick={qc.run} disabled={running || !!qc.blocker} aria-describedby={qc.blocker ? blockId : undefined}>
          {running ? "Converting…" : `Convert ${qc.ready.length || ""} file${qc.ready.length === 1 ? "" : "s"}`.replace("  ", " ")}
        </Button>
        {running && <Button onClick={() => void qc.cancel()}>Stop after this file</Button>}
        {!running && qc.files.length > 0 && (
          <Button variant="ghost" onClick={qc.clearFiles}>
            Clear list
          </Button>
        )}
        {!running && qc.blocker && qc.files.length > 0 && (
          <span id={blockId} className="qzk-qc-note">
            {qc.blocker}
          </span>
        )}
      </div>
      <ResultSummary job={qc.job} />
    </div>
  );
}
