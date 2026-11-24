// Quick Convert: the drop target plus the two ways to add files without dragging.
// "Add files…" browses the machine Quantized runs on (real paths, so "same folder
// as the input" works); "Upload…" uses the system file dialog (a browser hands
// over the bytes only, so those files need an output folder).

import { useRef, useState } from "react";
import clsx from "clsx";

import { Button } from "../../primitives";
import { useFileDrop } from "./useFileDrop";

interface Props {
  empty: boolean;
  disabled: boolean;
  onBrowse: () => void;
  onFiles: (files: File[]) => void;
}

export default function DropZone({ empty, disabled, onBrowse, onFiles }: Props) {
  const zone = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const over = useFileDrop(
    zone,
    (files) => {
      setNote(null);
      onFiles(files);
    },
    (names) => setNote(`Folders can’t be dropped (${names.join(", ")}). Drop the files inside, or use “Add files…”.`),
    !disabled,
  );
  return (
    <div
      ref={zone}
      className={clsx("qzk-qc-drop", empty && "qzk-qc-drop-empty", over && "qzk-qc-drop-over")}
      role="group"
      aria-label="Add files to convert"
    >
      <span className="qzk-qc-drop-text">
        {over ? "Drop to add" : empty ? "Drop files here to convert them" : "Drop more files here"}
      </span>
      <span className="qzk-qc-drop-actions">
        <Button size="sm" variant={empty ? "primary" : "default"} onClick={onBrowse} disabled={disabled}>
          Add files…
        </Button>
        <Button size="sm" variant="ghost" onClick={() => picker.current?.click()} disabled={disabled} title="Use the system file dialog; the files are copied to Quantized, so choose an output folder">
          Upload…
        </Button>
      </span>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        data-testid="qc-upload"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (picked.length) onFiles(picked);
        }}
      />
      {note && (
        <p role="alert" className="qzk-qc-note qzk-qc-danger">
          {note}
        </p>
      )}
    </div>
  );
}
